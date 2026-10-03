import dotenv from 'dotenv';
import { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  SlashCommandBuilder, 
  REST, 
  Routes,
  MessageFlags
} from 'discord.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

dotenv.config();

const token = process.env.DISCORD_TOKEN;
const otpEndpoint = process.env.OTP_ENDPOINT || 'https://ffmconnect.live.gop.garenanow.com/game/account_security/swap:send_otp';

// Parse optional server and user filters (comma-separated)
const allowedGuilds = (process.env.ALLOWED_GUILD_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

const allowedUsers = (process.env.ALLOWED_USER_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

// Path to persistent email storage
const dataPath = path.resolve('data.json');
if (!fs.existsSync(dataPath)) {
  fs.writeFileSync(dataPath, JSON.stringify([], null, 2));
}

function loadEmails() {
  try {
    const raw = fs.readFileSync(dataPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Error loading data.json:', err);
    return [];
  }
}

function saveEmails(arr) {
  try {
    fs.writeFileSync(dataPath, JSON.stringify(arr, null, 2));
  } catch (err) {
    console.error('Error saving data.json:', err);
  }
}

// Permission checking helper
function isAuthorized(guildId, userId) {
  if (allowedGuilds.length > 0 && (!guildId || !allowedGuilds.includes(guildId))) {
    return { authorized: false, reason: 'This command cannot be used in this server.' };
  }
  if (allowedUsers.length > 0 && !allowedUsers.includes(userId)) {
    return { authorized: false, reason: 'You do not have permission to execute this command.' };
  }
  return { authorized: true };
}

// Function to trigger Garena's OTP recovery endpoint
async function sendGarenaOtpRequest(email) {
  const isDirectGarena = otpEndpoint.includes('garena');

  if (isDirectGarena) {
    const bodyParams = new URLSearchParams({
      app_id: '100067',
      email: email,
      locale: 'en_IN'
    });

    const res = await fetch(otpEndpoint, {
      method: 'POST',
      headers: {
        'User-Agent': 'GarenaMSDK/4.0.39(ASUS_Z01QD ;Android 9;en;US;)',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Host': 'ffmconnect.live.gop.garenanow.com',
        'Connection': 'Keep-Alive'
      },
      body: bodyParams.toString()
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return { status: res.status, data };
  } else {
    // If configured to a local or proxy endpoint
    const res = await fetch(otpEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return { status: res.status, data };
  }
}

// Periodic task: Runs every 1 second to request OTP for all currently active registered emails
async function runOtpCycle() {
  const emails = loadEmails();
  if (emails.length === 0) return;

  const timestamp = new Date().toLocaleTimeString();
  console.log(`\n[${timestamp}] -- Running OTP cycle for ${emails.length} active email(s) --`);

  for (const email of emails) {
    // Re-check list before sending in case it was removed during the loop
    const currentList = loadEmails();
    if (!currentList.includes(email)) {
      console.log(`[${timestamp}] [SKIPPED] ${email} (removed in real-time)`);
      continue;
    }

    try {
      const { status, data } = await sendGarenaOtpRequest(email);
      if (data?.result === 0) {
        console.log(`[${timestamp}] [SUCCESS] OTP requested for ${email} (Garena confirmed: OTP sent)`);
      } else if (data?.url) {
        console.warn(`[${timestamp}] [WARNING] Garena required Captcha for ${email}`);
      } else {
        console.log(`[${timestamp}] [INFO] OTP request sent for ${email} (HTTP ${status}):`, data?.message || data?.error || data);
      }
    } catch (err) {
      console.error(`[${timestamp}] [ERROR] Failed OTP request for ${email}:`, err.message);
    }
  }
}

// Discord Client Setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// Slash Commands: /mail (add, remove, list) and /sendnow
const commands = [
  new SlashCommandBuilder()
    .setName('mail')
    .setDescription('Manage email addresses for Garena OTP requests')
    .addSubcommand(sub => 
      sub.setName('add')
        .setDescription('Add an email to start receiving OTP requests in real-time')
        .addStringOption(opt => 
          opt.setName('email')
            .setDescription('Target email address')
            .setRequired(true)
        )
    )
    .addSubcommand(sub => 
      sub.setName('remove')
        .setDescription('Remove an email and stop OTP requests in real-time')
        .addStringOption(opt => 
          opt.setName('email')
            .setDescription('Target email address')
            .setRequired(true)
        )
    )
    .addSubcommand(sub => 
      sub.setName('list')
        .setDescription('List all registered emails actively receiving OTPs')
    ),

  new SlashCommandBuilder()
    .setName('sendnow')
    .setDescription('Immediately trigger a Garena OTP request without waiting for the timer')
    .addStringOption(opt => 
      opt.setName('email')
        .setDescription('Optional: specific email (defaults to all registered emails)')
        .setRequired(false)
    )
];

// Register & refresh slash commands upon bot ready
client.once('clientReady', async () => {
  console.log(`Discord Bot logged in as ${client.user.tag}`);
  console.log(`Target Endpoint: ${otpEndpoint}`);
  console.log(`Allowed Servers: ${allowedGuilds.length ? allowedGuilds.join(', ') : 'All Servers'}`);
  console.log(`Allowed Users: ${allowedUsers.length ? allowedUsers.join(', ') : 'All Users'}`);

  const rest = new REST({ version: '10' }).setToken(token);
  const commandPayload = commands.map(c => c.toJSON());

  try {
    console.log('Refreshing slash commands to prevent duplicates...');

    if (allowedGuilds.length > 0) {
      // 1. Wipe global commands so they don't duplicate guild commands
      await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
      console.log('Cleared global commands');

      // 2. Register exclusively in the allowed guild(s) (instantly updates in Discord UI)
      for (const guildId of allowedGuilds) {
        try {
          await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commandPayload });
          console.log(`Registered slash commands in guild: ${guildId}`);
        } catch (gErr) {
          console.warn(`Could not register in guild ${guildId}:`, gErr.message);
        }
      }
    } else {
      // No specific guild configured: register once globally
      await rest.put(Routes.applicationCommands(client.user.id), { body: commandPayload });
      console.log('Registered global slash commands');
    }
  } catch (err) {
    console.error('Error refreshing slash commands:', err);
  }

  // Start continuous 1-second timer loop
  setInterval(runOtpCycle, 1 * 1000);
  console.log('OTP Request cycle active (runs every 1 second)');
});

// Real-time Handler: Add email
async function handleAddEmail(email) {
  if (!email || !email.includes('@')) {
    return { success: false, message: 'Please provide a valid email address.' };
  }
  const emailList = loadEmails();
  const lower = email.toLowerCase().trim();
  if (emailList.includes(lower)) {
    return { success: false, message: `[!] **${lower}** is already in the list.` };
  }

  // Save to persistent storage immediately
  emailList.push(lower);
  saveEmails(emailList);

  // Trigger immediate real-time OTP request
  let immediateFeedback = '';
  try {
    const { data } = await sendGarenaOtpRequest(lower);
    if (data?.result === 0) {
      immediateFeedback = '**Real-time OTP request dispatched immediately!**';
    } else {
      immediateFeedback = `Real-time request sent (Garena: ${data?.message || data?.error || 'Sent'})`;
    }
  } catch (err) {
    immediateFeedback = `Immediate request encountered: ${err.message}`;
  }

  return { 
    success: true, 
    message: `Added **${lower}** in real-time!\n${immediateFeedback}\nAutomatic requests will continue every 1 second.` 
  };
}

// Real-time Handler: Remove email
function handleRemoveEmail(email) {
  if (!email) {
    return { success: false, message: 'Please specify the email to remove.' };
  }
  const emailList = loadEmails();
  const lower = email.toLowerCase().trim();
  const index = emailList.indexOf(lower);
  if (index === -1) {
    return { success: false, message: `[!] **${lower}** was not found in the list.` };
  }

  // Remove immediately in real-time
  emailList.splice(index, 1);
  saveEmails(emailList);

  return { 
    success: true, 
    message: `**Stopped in real-time:** Removed **${lower}**.\nNo further OTP requests will be sent to this email.` 
  };
}

// Handler: List emails
function handleListEmails() {
  const emailList = loadEmails();
  if (emailList.length === 0) {
    return { count: 0, message: 'No emails are currently registered.' };
  }
  const formatted = emailList.map((m, idx) => `**${idx + 1}.** \`${m}\``).join('\n');
  return { 
    count: emailList.length, 
    message: `**Active Registered Emails (${emailList.length}):**\n${formatted}\n\n*Garena is requested to send OTP to these emails every 1 second.*` 
  };
}

// Interaction handling (Slash Commands)
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const auth = isAuthorized(interaction.guildId, interaction.user.id);
  if (!auth.authorized) {
    return interaction.reply({ content: `[Access Denied] ${auth.reason}`, flags: MessageFlags.Ephemeral });
  }

  const { commandName, options } = interaction;

  // Handle /mail add, /mail remove, /mail list
  if (commandName === 'mail') {
    const sub = options.getSubcommand();

    if (sub === 'add') {
      const email = options.getString('email');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await handleAddEmail(email);
      return interaction.editReply({ content: result.message });
    }

    if (sub === 'remove') {
      const email = options.getString('email');
      const result = handleRemoveEmail(email);
      return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'list') {
      const result = handleListEmails();
      return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
    }
  }

  // Handle /sendnow (Manual instant trigger)
  if (commandName === 'sendnow') {
    const targetEmail = options.getString('email')?.toLowerCase()?.trim();
    const emails = targetEmail ? [targetEmail] : loadEmails();

    if (emails.length === 0) {
      return interaction.reply({ 
        content: 'No emails to send to. Add one first with `/mail add <email>`', 
        flags: MessageFlags.Ephemeral 
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const results = [];
    for (const email of emails) {
      try {
        const { data } = await sendGarenaOtpRequest(email);
        results.push(`* **${email}**: ${data?.result === 0 ? '[SUCCESS] OTP requested successfully' : `[WARNING] ${data?.message || data?.error || 'Requested'}`}`);
      } catch (err) {
        results.push(`* **${email}**: [ERROR] Failed (${err.message})`);
      }
    }
    return interaction.editReply({ content: `**Manual OTP Request Results:**\n${results.join('\n')}` });
  }
});

// Text Command Support: !mail add, !mail remove, !mail list, !sendnow
client.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith('!')) return;

  const auth = isAuthorized(message.guildId, message.author.id);
  if (!auth.authorized) return;

  const raw = message.content.slice(1).trim();
  const lower = raw.toLowerCase();

  // !mail add <email>
  if (lower.startsWith('mail add ')) {
    const parts = raw.split(/\s+/);
    const email = parts[2];
    const msg = await message.reply('Adding and requesting OTP...');
    const res = await handleAddEmail(email);
    return msg.edit(res.message);
  }

  // !mail remove <email>
  if (lower.startsWith('mail remove ')) {
    const parts = raw.split(/\s+/);
    const email = parts[2];
    const res = handleRemoveEmail(email);
    return message.reply(res.message);
  }

  // !mail list
  if (lower === 'mail list') {
    const res = handleListEmails();
    return message.reply(res.message);
  }

  // !sendnow [email]
  if (lower.startsWith('sendnow')) {
    const parts = raw.split(/\s+/);
    const emailArg = parts[1]?.toLowerCase()?.trim();
    const emails = emailArg ? [emailArg] : loadEmails();
    if (emails.length === 0) {
      return message.reply('No emails registered. Use `!mail add <email>` first.');
    }
    const msg = await message.reply('Requesting OTP from Garena...');
    const results = [];
    for (const email of emails) {
      try {
        const { data } = await sendGarenaOtpRequest(email);
        results.push(`* **${email}**: ${data?.result === 0 ? '[SUCCESS] OTP sent' : `[WARNING] ${data?.message || data?.error || 'Requested'}`}`);
      } catch (err) {
        results.push(`* **${email}**: [ERROR] Failed (${err.message})`);
      }
    }
    return msg.edit(`**OTP Request Results:**\n${results.join('\n')}`);
  }
});

// Launch bot
if (!token || token === 'YOUR_DISCORD_BOT_TOKEN') {
  console.error('[ERROR] Please configure your DISCORD_TOKEN in discord-otp-bot/.env');
} else {
  client.login(token).catch(err => {
    console.error('[ERROR] Discord login failed:', err.message);
  });
}
