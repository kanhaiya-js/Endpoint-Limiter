import dotenv from 'dotenv';
import http from 'http';
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

const port = process.env.PORT || 3000;
http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Discord OTP Bot is running!\n');
}).listen(port, () => {
  console.log(`[HTTP] Health check server listening on port ${port}`);
});

const token = process.env.DISCORD_TOKEN;
const otpEndpoint = process.env.OTP_ENDPOINT;

const allowedGuilds = (process.env.ALLOWED_GUILD_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

const allowedUsers = (process.env.ALLOWED_USER_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

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

function isAuthorized(guildId, userId) {
  if (allowedGuilds.length > 0 && (!guildId || !allowedGuilds.includes(guildId))) {
    return { authorized: false, reason: 'This command cannot be used in this server.' };
  }
  if (allowedUsers.length > 0 && !allowedUsers.includes(userId)) {
    return { authorized: false, reason: 'You do not have permission to execute this command.' };
  }
  return { authorized: true };
}

async function sendGarenaOtpRequest(email) {
  if (!otpEndpoint) {
    throw new Error('OTP_ENDPOINT is not configured in .env or environment variables');
  }

  let hostHeader = '';
  try {
    hostHeader = new URL(otpEndpoint).host;
  } catch (err) {
    throw new Error(`Invalid OTP_ENDPOINT URL: ${err.message}`);
  }

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
        'Host': hostHeader,
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

async function runOtpCycle() {
  const emails = loadEmails();
  if (emails.length === 0) return;

  const timestamp = new Date().toLocaleTimeString();
  console.log(`\n[${timestamp}] -- Running OTP cycle for ${emails.length} active email(s) --`);

  for (const email of emails) {
    const currentList = loadEmails();
    if (!currentList.includes(email)) {
      console.log(`[${timestamp}] [SKIPPED] ${email} (removed in)`);
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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const commands = [
  new SlashCommandBuilder()
    .setName('mail')
    .setDescription('Manage email addresses')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add an email')
        .addStringOption(opt =>
          opt.setName('email')
            .setDescription('Target email address')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove an email')
        .addStringOption(opt =>
          opt.setName('email')
            .setDescription('Target email address')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all registered emails')
    ),

  new SlashCommandBuilder()
    .setName('sendnow')
    .setDescription('Immediately trigger a OTP')
    .addStringOption(opt =>
      opt.setName('email')
        .setDescription('Optional: specific email (defaults to all registered emails)')
        .setRequired(false)
    )
];

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
      await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
      console.log('Cleared global commands');

      for (const guildId of allowedGuilds) {
        try {
          await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commandPayload });
          console.log(`Registered slash commands in guild: ${guildId}`);
        } catch (gErr) {
          console.warn(`Could not register in guild ${guildId}:`, gErr.message);
        }
      }
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), { body: commandPayload });
      console.log('Registered global slash commands');
    }
  } catch (err) {
    console.error('Error refreshing slash commands:', err);
  }

  setInterval(runOtpCycle, 1 * 1000);
  console.log('OTP Request cycle active (runs every 1 second)');
});

async function handleAddEmail(email) {
  if (!email || !email.includes('@')) {
    return { success: false, message: 'Please provide a valid email address.' };
  }
  const emailList = loadEmails();
  const lower = email.toLowerCase().trim();
  if (emailList.includes(lower)) {
    return { success: false, message: `[!] **${lower}** is already in the list.` };
  }

  emailList.push(lower);
  saveEmails(emailList);

  let immediateFeedback = '';
  try {
    const { data } = await sendGarenaOtpRequest(lower);
    if (data?.result === 0) {
      immediateFeedback = '**OTP request dispatched immediately!**';
    } else {
      immediateFeedback = `request sent (Garena: ${data?.message || data?.error || 'Sent'})`;
    }
  } catch (err) {
    immediateFeedback = `Immediate request encountered: ${err.message}`;
  }

  return {
    success: true,
    message: `Added **${lower}** in!\n${immediateFeedback}\nAutomatic requests will continue every 1 second.`
  };
}

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

  emailList.splice(index, 1);
  saveEmails(emailList);

  return {
    success: true,
    message: `**Stopped in:** Removed **${lower}**.\nNo further OTP requests will be sent to this email.`
  };
}

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

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const auth = isAuthorized(interaction.guildId, interaction.user.id);
  if (!auth.authorized) {
    return interaction.reply({ content: `[Access Denied] ${auth.reason}`, flags: MessageFlags.Ephemeral });
  }

  const { commandName, options } = interaction;

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

client.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith('!')) return;

  const auth = isAuthorized(message.guildId, message.author.id);
  if (!auth.authorized) return;

  const raw = message.content.slice(1).trim();
  const lower = raw.toLowerCase();

  if (lower.startsWith('mail add ')) {
    const parts = raw.split(/\s+/);
    const email = parts[2];
    const msg = await message.reply('Adding and requesting OTP...');
    const res = await handleAddEmail(email);
    return msg.edit(res.message);
  }

  if (lower.startsWith('mail remove ')) {
    const parts = raw.split(/\s+/);
    const email = parts[2];
    const res = handleRemoveEmail(email);
    return message.reply(res.message);
  }

  if (lower === 'mail list') {
    const res = handleListEmails();
    return message.reply(res.message);
  }

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

if (!token || token === 'YOUR_DISCORD_BOT_TOKEN') {
  console.error('[ERROR] Please configure your DISCORD_TOKEN in .env or environment variables');
} else if (!otpEndpoint) {
  console.error('[ERROR] Please configure OTP_ENDPOINT in .env or environment variables');
} else {
  client.login(token).catch(err => {
    console.error('[ERROR] Discord login failed:', err.message);
  });
}
