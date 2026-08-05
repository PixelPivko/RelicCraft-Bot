require("dotenv").config();

const {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const fs = require("node:fs");
const dns = require("node:dns").promises;
const net = require("node:net");
const path = require("node:path");

const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  moderatorRoleId: process.env.MODERATOR_ROLE_ID || "1524825124019241011",
  verifiedRoleId: process.env.VERIFIED_ROLE_ID,
  unverifiedRoleId: process.env.UNVERIFIED_ROLE_ID || "1527318533325717584",
  muteRoleId: process.env.MUTE_ROLE_ID,
  blacklistRoleId: process.env.BLACKLIST_ROLE_ID,
  verifyChannelId: process.env.VERIFY_CHANNEL_ID,
  appealUrl: process.env.APPEAL_URL || "https://discord.gg/CYJ4bfTYMN",
  minecraftHost: process.env.MC_SERVER_HOST,
  minecraftPort: process.env.MC_SERVER_PORT ? Number(process.env.MC_SERVER_PORT) : null,
  minecraftStatusChannelId: process.env.MC_STATUS_CHANNEL_ID,
  minecraftStatusIntervalMs: Number(process.env.MC_STATUS_INTERVAL_MS || 35_000),
  antiSpamEnabled: process.env.ANTI_SPAM_ENABLED !== "false",
  antiPhishingEnabled: process.env.ANTI_PHISHING_ENABLED !== "false",
  antiSpamMaxMessages: Number(process.env.ANTI_SPAM_MAX_MESSAGES || 5),
  antiSpamWindowMs: Number(process.env.ANTI_SPAM_WINDOW_MS || 7_000),
  antiSpamTimeoutMs: Number(process.env.ANTI_SPAM_TIMEOUT_MS || 60_000),
  xpMin: Number(process.env.XP_MIN || 15),
  xpMax: Number(process.env.XP_MAX || 25),
  xpCooldownMs: Number(process.env.XP_COOLDOWN_MS || 60_000),
  blockedWords: (process.env.BLOCKED_WORDS || "")
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean),
};

const DATA_DIR = path.join(__dirname, "..", "data");
const PUNISHMENTS_FILE = path.join(DATA_DIR, "punishments.json");
const STATUS_MESSAGE_FILE = path.join(DATA_DIR, "minecraft-status-message.json");
const BLOCKED_WORDS_FILE = path.join(DATA_DIR, "blocked-words.json");
const LEVELS_FILE = path.join(DATA_DIR, "levels.json");
const WARNINGS_FILE = path.join(DATA_DIR, "warnings.json");
const messageBuckets = new Map();
const xpCooldowns = new Map();
const PHISHING_PATTERNS = [
  /discord(?:app)?\.(?:gift|gifts|nitro)/i,
  /d[i1l]sc[o0]rd(?:app)?\.(?:gift|gifts|nitro|gg)/i,
  /free\s*(?:nitro|steam|robux|crypto)/i,
  /nitro\s*(?:free|gift|бесплатн)/i,
  /steam(?:community|cornmunity|communnity)\.[a-z]+\/(?:gift|promo|trade)/i,
  /(?:mr\s*beast|mrbeast|мистер\s*бист|мистер\s*биста).*(?:casino|казино|crypto|крипт|usdt|btc|bitcoin|биткоин)/i,
  /(?:casino|казино|crypto|крипт|usdt|btc|bitcoin|биткоин).*(?:mr\s*beast|mrbeast|мистер\s*бист|мистер\s*биста)/i,
];
const SUSPICIOUS_DOMAINS = [
  "discord-gift",
  "discordgift",
  "discordnitro",
  "free-nitro",
  "steamgift",
  "mrbeast",
  "crypto-casino",
];
const EMPTY_PLAYER_MESSAGES = [
  "Здесь пусто... Грустно...",
  "Мысли в голове",
  "Я схожу с ума",
  "Голова в мыслях",
  "мЫслан",
  "абоба",
  "дух сталина",
  "Herobrine",
  "Крипер ушел за хлебом",
  "Стив задумался о смысле алмазов",
  "Тут был блок, но он ушел",
  "Эхо шахты отвечает тишиной",
  "Одинокий верстак ждет мастера",
  "Печь остыла, уголь грустит",
  "Зомби опоздал на смену",
  "Деревня спит, жители в афке",
  "Алмазы спрятались глубже обычного",
  "Редстоун молчит подозрительно громко",
  "Кто-то поставил факел и исчез",
  "Пустота смотрит в чат",
  "Скелет репетирует соло",
  "Лава булькает без свидетелей",
  "Трава растет, онлайн ждет",
  "Кубическая тишина",
  "На спавне перекати-блок",
  "Инвентарь пуст, душа тоже",
  "Пинг есть, людей нет",
  "RelicCraft ждет героя",
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function ensureConfig() {
  const required = [
    ["DISCORD_TOKEN", CONFIG.token],
    ["CLIENT_ID", CONFIG.clientId],
    ["GUILD_ID", CONFIG.guildId],
    ["VERIFIED_ROLE_ID", CONFIG.verifiedRoleId],
    ["MUTE_ROLE_ID", CONFIG.muteRoleId],
    ["BLACKLIST_ROLE_ID", CONFIG.blacklistRoleId],
  ];

  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing required .env values: ${missing.join(", ")}`);
  }
}

function loadPunishments() {
  if (!fs.existsSync(PUNISHMENTS_FILE)) return [];
  return JSON.parse(fs.readFileSync(PUNISHMENTS_FILE, "utf8"));
}

function savePunishments(punishments) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PUNISHMENTS_FILE, JSON.stringify(punishments, null, 2));
}

function addPunishment(punishment) {
  const punishments = loadPunishments().filter(
    (item) => !(item.guildId === punishment.guildId && item.userId === punishment.userId && item.type === punishment.type),
  );
  punishments.push(punishment);
  savePunishments(punishments);
}

function removePunishment(guildId, userId, type) {
  const punishments = loadPunishments().filter(
    (item) => !(item.guildId === guildId && item.userId === userId && item.type === type),
  );
  savePunishments(punishments);
}

function loadJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJsonFile(filePath, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function xpForLevel(level) {
  return level * level * 100;
}

function levelFromXp(xp) {
  return Math.floor(Math.sqrt(xp / 100));
}

function getRankRecord(userId) {
  const levels = loadJsonFile(LEVELS_FILE, {});
  return levels[userId] || { xp: 0, level: 0, messages: 0 };
}

function rankEmbed(user, record, rankPosition = null) {
  const currentLevelXp = xpForLevel(record.level);
  const nextLevelXp = xpForLevel(record.level + 1);
  const progress = Math.max(0, record.xp - currentLevelXp);
  const needed = Math.max(1, nextLevelXp - currentLevelXp);
  const progressBarSize = 12;
  const filled = Math.min(progressBarSize, Math.floor((progress / needed) * progressBarSize));
  const bar = `${"█".repeat(filled)}${"░".repeat(progressBarSize - filled)}`;

  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`RelicCraft | Ранг ${user.username}`)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: "Уровень", value: String(record.level), inline: true },
      { name: "XP", value: `${record.xp}/${nextLevelXp}`, inline: true },
      { name: "Сообщений", value: String(record.messages || 0), inline: true },
      { name: "Прогресс", value: `${bar} ${progress}/${needed}` },
      { name: "Место", value: rankPosition ? `#${rankPosition}` : "Не рассчитано", inline: true },
    )
    .setFooter({ text: "Relic-Bot • уровни RelicCraft" });
}

function getRankPosition(userId) {
  const levels = loadJsonFile(LEVELS_FILE, {});
  const sorted = Object.entries(levels).sort(([, a], [, b]) => (b.xp || 0) - (a.xp || 0));
  const index = sorted.findIndex(([id]) => id === userId);
  return index >= 0 ? index + 1 : null;
}

async function handleXp(message) {
  if (!message.guild || message.author.bot) return;

  const now = Date.now();
  const key = `${message.guildId}:${message.author.id}`;
  if (xpCooldowns.has(key) && now - xpCooldowns.get(key) < CONFIG.xpCooldownMs) return;
  xpCooldowns.set(key, now);

  const levels = loadJsonFile(LEVELS_FILE, {});
  const record = levels[message.author.id] || { xp: 0, level: 0, messages: 0 };
  const oldLevel = record.level || 0;
  const gained = Math.floor(Math.random() * (CONFIG.xpMax - CONFIG.xpMin + 1)) + CONFIG.xpMin;

  record.xp = (record.xp || 0) + gained;
  record.messages = (record.messages || 0) + 1;
  record.level = levelFromXp(record.xp);
  levels[message.author.id] = record;
  saveJsonFile(LEVELS_FILE, levels);

  if (record.level > oldLevel) {
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("RelicCraft | Новый уровень!")
      .setDescription(`Поздравляю, ты повысил уровень до **${record.level}**.`)
      .addFields({ name: "Текущий XP", value: String(record.xp), inline: true })
      .setFooter({ text: "Relic-Bot • продолжай общаться на сервере" });
    await message.author.send({ embeds: [embed] }).catch(() => null);
  }
}

function loadWarnings() {
  return loadJsonFile(WARNINGS_FILE, {});
}

function saveWarnings(warnings) {
  saveJsonFile(WARNINGS_FILE, warnings);
}

function loadBlockedWords() {
  let fileWords = [];
  if (fs.existsSync(BLOCKED_WORDS_FILE)) {
    try {
      fileWords = JSON.parse(fs.readFileSync(BLOCKED_WORDS_FILE, "utf8"));
    } catch {
      fileWords = [];
    }
  }

  return [...CONFIG.blockedWords, ...fileWords]
    .map((word) => String(word).trim().toLowerCase())
    .filter(Boolean);
}

function normalizeMessageContent(content) {
  return content
    .toLowerCase()
    .replace(/[\u200b-\u200f\u202a-\u202e]/g, "")
    .replace(/[|`_*~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactMessageContent(content) {
  return normalizeMessageContent(content)
    .replace(/[4@]/g, "a")
    .replace(/[3]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[5$]/g, "s")
    .replace(/[7]/g, "t")
    .replace(/[^a-zа-яё0-9]/gi, "");
}

function hasBlockedWord(content) {
  const normalized = normalizeMessageContent(content);
  const compact = compactMessageContent(content);
  return loadBlockedWords().some((word) => {
    const normalizedWord = normalizeMessageContent(word);
    const compactWord = compactMessageContent(word);
    return normalized.includes(normalizedWord) || (compactWord.length >= 3 && compact.includes(compactWord));
  });
}

function hasUrl(content) {
  return /(https?:\/\/|www\.|discord\.gg\/|\.ru|\.com|\.net|\.online|\.site|\.xyz)/i.test(content);
}

function isPhishingOrScam(message) {
  const content = normalizeMessageContent(message.content);
  const hasAttachment = message.attachments.size > 0;
  const containsSuspiciousDomain = SUSPICIOUS_DOMAINS.some((part) => content.includes(part));
  const broScam = /\bbro\b/i.test(content) && (hasUrl(content) || hasAttachment);

  return (
    PHISHING_PATTERNS.some((pattern) => pattern.test(content)) ||
    containsSuspiciousDomain ||
    broScam
  );
}

function isSpam(message) {
  const now = Date.now();
  const key = `${message.guildId}:${message.author.id}`;
  const bucket = messageBuckets.get(key) || { timestamps: [], lastContent: "", repeats: 0 };
  const normalized = normalizeMessageContent(message.content);

  bucket.timestamps = bucket.timestamps.filter((timestamp) => now - timestamp <= CONFIG.antiSpamWindowMs);
  bucket.timestamps.push(now);
  bucket.repeats = normalized && normalized === bucket.lastContent ? bucket.repeats + 1 : 1;
  bucket.lastContent = normalized;
  messageBuckets.set(key, bucket);

  return bucket.timestamps.length > CONFIG.antiSpamMaxMessages || bucket.repeats >= 3;
}

async function deleteMessage(message, reason) {
  await message.delete().catch(() => null);

  if (reason === "spam" && message.member?.moderatable) {
    await message.member.timeout(CONFIG.antiSpamTimeoutMs, "Relic-Bot anti-spam").catch(() => null);
  }
}

async function handleAutoModeration(message) {
  if (!message.guild || message.author.bot) return false;

  if (CONFIG.antiPhishingEnabled && isPhishingOrScam(message)) {
    await deleteMessage(message, "phishing");
    return true;
  }

  if (hasBlockedWord(message.content)) {
    await deleteMessage(message, "blocked-word");
    return true;
  }

  if (CONFIG.antiSpamEnabled && isSpam(message)) {
    await deleteMessage(message, "spam");
    return true;
  }

  return false;
}

function writeVarInt(value) {
  const bytes = [];
  let number = value;
  do {
    let temp = number & 0x7f;
    number >>>= 7;
    if (number !== 0) temp |= 0x80;
    bytes.push(temp);
  } while (number !== 0);
  return Buffer.from(bytes);
}

function readVarInt(buffer, offset = 0) {
  let value = 0;
  let position = 0;
  let currentByte;

  do {
    currentByte = buffer[offset + position];
    value |= (currentByte & 0x7f) << (7 * position);
    position += 1;
    if (position > 5) throw new Error("VarInt is too big");
  } while ((currentByte & 0x80) === 0x80);

  return { value, size: position };
}

function writeString(value) {
  const text = Buffer.from(value, "utf8");
  return Buffer.concat([writeVarInt(text.length), text]);
}

function createMinecraftPacket(...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([writeVarInt(body.length), body]);
}

function parseMinecraftResponse(buffer) {
  let offset = 0;
  const packetLength = readVarInt(buffer, offset);
  offset += packetLength.size;
  const packetId = readVarInt(buffer, offset);
  offset += packetId.size;
  const jsonLength = readVarInt(buffer, offset);
  offset += jsonLength.size;
  return JSON.parse(buffer.subarray(offset, offset + jsonLength.value).toString("utf8"));
}

async function resolveMinecraftTarget() {
  if (!CONFIG.minecraftHost) return null;

  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${CONFIG.minecraftHost}`);
    if (records.length > 0) {
      const record = records.sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
      return {
        connectHost: record.name,
        connectPort: record.port,
        displayHost: CONFIG.minecraftHost,
        displayPort: record.port,
      };
    }
  } catch {
    // No SRV record, use direct host and configured/default port.
  }

  return {
    connectHost: CONFIG.minecraftHost,
    connectPort: CONFIG.minecraftPort || 25565,
    displayHost: CONFIG.minecraftHost,
    displayPort: CONFIG.minecraftPort || 25565,
  };
}

async function pingMinecraftServer() {
  const target = await resolveMinecraftTarget();

  return new Promise((resolve) => {
    if (!target) {
      resolve(null);
      return;
    }

    const socket = net.createConnection({ host: target.connectHost, port: target.connectPort });
    const chunks = [];
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(5_000);
    socket.on("timeout", () => finish({ online: false }));
    socket.on("error", () => finish({ online: false }));
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      try {
        const response = parseMinecraftResponse(Buffer.concat(chunks));
        finish({
          online: true,
          onlinePlayers: response.players?.online || 0,
          maxPlayers: response.players?.max || 0,
          players: response.players?.sample?.map((player) => player.name) || [],
          version: response.version?.name || "unknown",
          displayAddress: `${target.displayHost}:${target.displayPort}`,
        });
      } catch {
        // Wait for the rest of the packet.
      }
    });

    socket.on("connect", () => {
      const handshake = createMinecraftPacket(
        writeVarInt(0),
        writeVarInt(767),
        writeString(target.displayHost),
        Buffer.from([(target.connectPort >> 8) & 0xff, target.connectPort & 0xff]),
        writeVarInt(1),
      );
      const request = createMinecraftPacket(writeVarInt(0));
      socket.write(Buffer.concat([handshake, request]));
    });
  });
}

function loadStatusMessageId() {
  if (!fs.existsSync(STATUS_MESSAGE_FILE)) return null;
  return JSON.parse(fs.readFileSync(STATUS_MESSAGE_FILE, "utf8")).messageId;
}

function saveStatusMessageId(messageId) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATUS_MESSAGE_FILE, JSON.stringify({ messageId }, null, 2));
}

function createMinecraftStatusEmbed(status) {
  const fallbackAddress = `${CONFIG.minecraftHost}:${CONFIG.minecraftPort || 25565}`;

  if (!status || !status.online) {
    return new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("RelicCraft | Онлайн сервера")
      .setDescription("Сервер сейчас недоступен или не отвечает на ping.")
      .addFields({ name: "Адрес", value: fallbackAddress })
      .setTimestamp();
  }

  const emptyPlayerMessage = EMPTY_PLAYER_MESSAGES[Math.floor(Math.random() * EMPTY_PLAYER_MESSAGES.length)];
  const playerList = status.players.length > 0
    ? status.players.map((name) => `• ${name}`).join("\n")
    : emptyPlayerMessage;

  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("RelicCraft | Онлайн сервера")
    .setDescription(`Сейчас на сервере **${status.onlinePlayers}/${status.maxPlayers}** игроков.`)
    .addFields(
      { name: "Адрес", value: status.displayAddress || fallbackAddress, inline: true },
      { name: "Версия", value: status.version, inline: true },
      { name: "Кто играет", value: playerList.slice(0, 1024) },
    )
    .setFooter({ text: "Сообщение обновляется автоматически" })
    .setTimestamp();
}

async function updateMinecraftStatus() {
  if (!CONFIG.minecraftHost) return;

  const status = await pingMinecraftServer();
  if (status?.online) {
    client.user.setActivity(`RelicCraft: ${status.onlinePlayers}/${status.maxPlayers} онлайн`, { type: ActivityType.Watching });
  } else {
    client.user.setActivity("RelicCraft: сервер оффлайн", { type: ActivityType.Watching });
  }

  if (!CONFIG.minecraftStatusChannelId) return;

  const channel = await client.channels.fetch(CONFIG.minecraftStatusChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = createMinecraftStatusEmbed(status);
  const messageId = loadStatusMessageId();
  const oldMessage = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;

  if (oldMessage) {
    await oldMessage.edit({ embeds: [embed] });
    return;
  }

  const message = await channel.send({ embeds: [embed] });
  saveStatusMessageId(message.id);
}

function parseDuration(input, allowPermanent = false) {
  const value = String(input || "").trim().toLowerCase();
  if (allowPermanent && ["perm", "permanent", "forever", "навсегда", "перманентно"].includes(value)) {
    return { permanent: true, ms: null, label: "перманентно" };
  }

  const match = value.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new Error(allowPermanent ? "Укажи срок в формате 10m, 2h, 7d или permanent." : "Укажи срок в формате 10m, 2h или 7d.");
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers = { m: 60_000, h: 3_600_000, d: 86_400_000 };
  const names = { m: "мин.", h: "ч.", d: "д." };

  return {
    permanent: false,
    ms: amount * multipliers[unit],
    label: `${amount} ${names[unit]}`,
  };
}

function formatRemaining(endsAt) {
  const remainingMs = Math.max(0, endsAt - Date.now());
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days) parts.push(`${days} д.`);
  if (hours) parts.push(`${hours} ч.`);
  if (minutes || parts.length === 0) parts.push(`${minutes} мин.`);
  return parts.join(" ");
}

function appealButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Обжаловать")
      .setStyle(ButtonStyle.Link)
      .setURL(CONFIG.appealUrl),
  );
}

function verificationButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("relic_verify")
      .setLabel("Пройти верификацию")
      .setStyle(ButtonStyle.Success),
  );
}

async function sendPunishmentDm(user, options) {
  const adminLine = `${options.admin} (${options.admin.username})`;
  const durationLine = options.permanent
    ? "К сожалению ты получил это перманентно."
    : `Тебе осталось ждать ${options.remaining}.`;

  const embed = new EmbedBuilder()
    .setColor(0xd93c3c)
    .setTitle("Привет! Я Relic-Bot!")
    .setDescription(
      [
        `Ты получил ${options.actionName} от Администратора ${adminLine}`,
        `за нарушение правил (${options.reason})`,
        durationLine,
        "Нажми сюда чтобы обжаловать:",
      ].join("\n"),
    );

  try {
    await user.send({ embeds: [embed], components: [appealButtonRow()] });
    return true;
  } catch {
    return false;
  }
}

function hasModeratorRole(member) {
  return member.roles.cache.has(CONFIG.moderatorRoleId);
}

async function requireModerator(interaction) {
  if (hasModeratorRole(interaction.member)) return true;
  await interaction.reply({ content: "У тебя нет прав использовать эту команду.", ephemeral: true });
  return false;
}

async function getTargetMember(interaction) {
  const user = interaction.options.getUser("user", true);
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: "Не могу найти этого участника на сервере.", ephemeral: true });
    return null;
  }
  return member;
}

function commands() {
  return [
    new SlashCommandBuilder()
      .setName("verify-panel")
      .setDescription("Создать панель верификации RelicCraft")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("kick")
      .setDescription("Кикнуть участника")
      .addUserOption((option) => option.setName("user").setDescription("Участник").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Причина").setRequired(true)),

    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("Выдать Discord-таймаут")
      .addUserOption((option) => option.setName("user").setDescription("Участник").setRequired(true))
      .addStringOption((option) => option.setName("duration").setDescription("10m, 2h или 7d").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Причина").setRequired(true)),

    new SlashCommandBuilder()
      .setName("mute")
      .setDescription("Выдать мут")
      .addUserOption((option) => option.setName("user").setDescription("Участник").setRequired(true))
      .addStringOption((option) => option.setName("duration").setDescription("10m, 2h, 7d или permanent").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Причина").setRequired(true)),

    new SlashCommandBuilder()
      .setName("unmute")
      .setDescription("Снять мут")
      .addUserOption((option) => option.setName("user").setDescription("Участник").setRequired(true)),

    new SlashCommandBuilder()
      .setName("blacklist")
      .setDescription("Выдать ЧСП")
      .addUserOption((option) => option.setName("user").setDescription("Участник").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Причина").setRequired(true)),

    new SlashCommandBuilder()
      .setName("unblacklist")
      .setDescription("Снять ЧСП")
      .addUserOption((option) => option.setName("user").setDescription("Участник").setRequired(true)),
    new SlashCommandBuilder()
      .setName("clear")
      .setDescription("Очистить сообщения в канале, до 500")
      .addIntegerOption((option) => option.setName("amount").setDescription("Количество от 1 до 500").setRequired(true).setMinValue(1).setMaxValue(500))
      .addUserOption((option) => option.setName("user").setDescription("Удалять только сообщения участника").setRequired(false)),

    new SlashCommandBuilder()
      .setName("rank")
      .setDescription("Показать уровень и рейтинг")
      .addUserOption((option) => option.setName("user").setDescription("Участник").setRequired(false)),

    new SlashCommandBuilder()
      .setName("ранг")
      .setDescription("Показать уровень и рейтинг")
      .addUserOption((option) => option.setName("user").setDescription("Участник").setRequired(false)),

    new SlashCommandBuilder()
      .setName("warn")
      .setDescription("Выдать предупреждение")
      .addUserOption((option) => option.setName("user").setDescription("Участник").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Причина").setRequired(true)),

    new SlashCommandBuilder()
      .setName("warnings")
      .setDescription("Показать предупреждения участника")
      .addUserOption((option) => option.setName("user").setDescription("Участник").setRequired(true)),

    new SlashCommandBuilder()
      .setName("unwarn")
      .setDescription("Удалить предупреждение по номеру")
      .addUserOption((option) => option.setName("user").setDescription("Участник").setRequired(true))
      .addIntegerOption((option) => option.setName("index").setDescription("Номер предупреждения").setRequired(true).setMinValue(1)),

    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Забанить участника")
      .addUserOption((option) => option.setName("user").setDescription("Участник").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Причина").setRequired(true))
      .addIntegerOption((option) => option.setName("delete_days").setDescription("Удалить сообщения за N дней, 0-7").setRequired(false).setMinValue(0).setMaxValue(7)),

    new SlashCommandBuilder()
      .setName("unban")
      .setDescription("Разбанить по ID")
      .addStringOption((option) => option.setName("user_id").setDescription("ID пользователя").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Причина").setRequired(false)),

    new SlashCommandBuilder()
      .setName("lock")
      .setDescription("Закрыть канал для @everyone"),

    new SlashCommandBuilder()
      .setName("unlock")
      .setDescription("Открыть канал для @everyone"),

    new SlashCommandBuilder()
      .setName("slowmode")
      .setDescription("Поставить медленный режим")
      .addIntegerOption((option) => option.setName("seconds").setDescription("Секунды, 0 чтобы выключить").setRequired(true).setMinValue(0).setMaxValue(21600)),
  ].map((command) => command.toJSON());
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(CONFIG.token);
  await rest.put(Routes.applicationGuildCommands(CONFIG.clientId, CONFIG.guildId), { body: commands() });
}

async function handleVerifyPanel(interaction) {
  if (CONFIG.verifyChannelId && interaction.channelId !== CONFIG.verifyChannelId) {
    await interaction.reply({ content: "Эту команду можно использовать только в канале верификации.", ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("RelicCraft | Верификация")
    .setDescription(
      [
        "Добро пожаловать на сервер RelicCraft.",
        "",
        "Чтобы получить доступ к основным каналам, нажми кнопку ниже. После проверки бот выдаст тебе роль участника и снимет роль не верифицированного.",
      ].join("\n"),
    )
    .addFields(
      {
        name: "Зачем это нужно?",
        value: "Верификация помогает защитить сервер от спама, ботов и случайных нарушителей.",
      },
      {
        name: "Что будет после нажатия?",
        value: "Ты получишь доступ к каналам сервера и сможешь спокойно общаться с участниками.",
      },
      {
        name: "Если что-то не сработало",
        value: "Напиши администрации сервера, и тебе помогут вручную.",
      },
    )
    .setFooter({ text: "Relic-Bot • защита и порядок на RelicCraft" });

  await interaction.reply({ embeds: [embed], components: [verificationButtonRow()] });
}

async function handleKick(interaction) {
  if (!(await requireModerator(interaction))) return;
  const member = await getTargetMember(interaction);
  if (!member) return;

  const reason = interaction.options.getString("reason", true);
  const dmSent = await sendPunishmentDm(member.user, {
    actionName: "кик",
    admin: interaction.user,
    reason,
    permanent: true,
  });

  await member.kick(reason);
  await interaction.reply(`Участник ${member.user.tag} кикнут. ЛС: ${dmSent ? "отправлено" : "закрыты"}.`);
}

async function handleTimeout(interaction) {
  if (!(await requireModerator(interaction))) return;
  const member = await getTargetMember(interaction);
  if (!member) return;

  const reason = interaction.options.getString("reason", true);
  const duration = parseDuration(interaction.options.getString("duration", true));
  const endsAt = Date.now() + duration.ms;

  await member.timeout(duration.ms, reason);
  const dmSent = await sendPunishmentDm(member.user, {
    actionName: "таймаут",
    admin: interaction.user,
    reason,
    permanent: false,
    remaining: formatRemaining(endsAt),
  });

  await interaction.reply(`Участник ${member.user.tag} получил таймаут на ${duration.label}. ЛС: ${dmSent ? "отправлено" : "закрыты"}.`);
}

async function handleMute(interaction) {
  if (!(await requireModerator(interaction))) return;
  const member = await getTargetMember(interaction);
  if (!member) return;

  const reason = interaction.options.getString("reason", true);
  const duration = parseDuration(interaction.options.getString("duration", true), true);
  const endsAt = duration.permanent ? null : Date.now() + duration.ms;

  await member.roles.add(CONFIG.muteRoleId, reason);
  if (!duration.permanent) {
    addPunishment({ guildId: interaction.guildId, userId: member.id, type: "mute", endsAt });
  }

  const dmSent = await sendPunishmentDm(member.user, {
    actionName: "мут",
    admin: interaction.user,
    reason,
    permanent: duration.permanent,
    remaining: duration.permanent ? null : formatRemaining(endsAt),
  });

  await interaction.reply(`Участник ${member.user.tag} получил мут ${duration.permanent ? "навсегда" : `на ${duration.label}`}. ЛС: ${dmSent ? "отправлено" : "закрыты"}.`);
}

async function handleUnmute(interaction) {
  if (!(await requireModerator(interaction))) return;
  const member = await getTargetMember(interaction);
  if (!member) return;

  await member.roles.remove(CONFIG.muteRoleId, "Mute removed by moderator").catch(() => null);
  await member.timeout(null, "Timeout removed by moderator").catch(() => null);
  removePunishment(interaction.guildId, member.id, "mute");
  await interaction.reply(`Мут снят с ${member.user.tag}.`);
}

async function handleBlacklist(interaction) {
  if (!(await requireModerator(interaction))) return;
  const member = await getTargetMember(interaction);
  if (!member) return;

  const reason = interaction.options.getString("reason", true);
  await member.roles.add(CONFIG.blacklistRoleId, reason);

  const dmSent = await sendPunishmentDm(member.user, {
    actionName: "ЧСП",
    admin: interaction.user,
    reason,
    permanent: true,
  });

  await interaction.reply(`Участник ${member.user.tag} добавлен в ЧСП. ЛС: ${dmSent ? "отправлено" : "закрыты"}.`);
}

async function handleUnblacklist(interaction) {
  if (!(await requireModerator(interaction))) return;
  const member = await getTargetMember(interaction);
  if (!member) return;

  await member.roles.remove(CONFIG.blacklistRoleId, "Blacklist removed by moderator");
  await interaction.reply(`ЧСП снят с ${member.user.tag}.`);
}

async function handleClear(interaction) {
  if (!(await requireModerator(interaction))) return;
  const amount = interaction.options.getInteger("amount", true);
  const user = interaction.options.getUser("user");
  const channel = interaction.channel;

  if (!channel?.bulkDelete || !channel.messages?.fetch) {
    await interaction.reply({ content: "В этом канале нельзя очищать сообщения.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  let deletedTotal = 0;
  let lastId = null;

  while (deletedTotal < amount) {
    const fetchLimit = Math.min(100, amount - deletedTotal);
    const fetched = await channel.messages.fetch({ limit: fetchLimit, before: lastId || undefined }).catch(() => null);
    if (!fetched || fetched.size === 0) break;

    lastId = fetched.last()?.id;
    const filtered = user ? fetched.filter((message) => message.author.id === user.id) : fetched;
    if (filtered.size > 0) {
      const deleted = await channel.bulkDelete(filtered, true).catch(() => null);
      deletedTotal += deleted?.size || 0;
    }

    if (fetched.size < fetchLimit) break;
    if (user && filtered.size === 0) continue;
  }

  await interaction.editReply(`Очищено сообщений: ${deletedTotal}/${amount}.`);
}

async function handleRank(interaction) {
  const user = interaction.options.getUser("user") || interaction.user;
  const record = getRankRecord(user.id);
  await interaction.reply({ embeds: [rankEmbed(user, record, getRankPosition(user.id))] });
}

async function handleWarn(interaction) {
  if (!(await requireModerator(interaction))) return;
  const member = await getTargetMember(interaction);
  if (!member) return;

  const reason = interaction.options.getString("reason", true);
  const warnings = loadWarnings();
  const userWarnings = warnings[member.id] || [];
  userWarnings.push({
    reason,
    moderatorId: interaction.user.id,
    createdAt: new Date().toISOString(),
  });
  warnings[member.id] = userWarnings;
  saveWarnings(warnings);

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("RelicCraft | Предупреждение")
    .setDescription(`Ты получил предупреждение от ${interaction.user}.`)
    .addFields(
      { name: "Причина", value: reason },
      { name: "Всего предупреждений", value: String(userWarnings.length), inline: true },
    );
  await member.user.send({ embeds: [embed] }).catch(() => null);
  await interaction.reply(`Предупреждение выдано ${member.user.tag}. Всего: ${userWarnings.length}.`);
}

async function handleWarnings(interaction) {
  if (!(await requireModerator(interaction))) return;
  const user = interaction.options.getUser("user", true);
  const warnings = loadWarnings()[user.id] || [];

  if (warnings.length === 0) {
    await interaction.reply({ content: `У ${user.tag} нет предупреждений.`, ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`Предупреждения ${user.tag}`)
    .setDescription(
      warnings
        .map((warning, index) => `${index + 1}. ${warning.reason} — <@${warning.moderatorId}>`)
        .join("\n")
        .slice(0, 4000),
    );
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleUnwarn(interaction) {
  if (!(await requireModerator(interaction))) return;
  const user = interaction.options.getUser("user", true);
  const index = interaction.options.getInteger("index", true) - 1;
  const warnings = loadWarnings();
  const userWarnings = warnings[user.id] || [];

  if (!userWarnings[index]) {
    await interaction.reply({ content: "Предупреждение с таким номером не найдено.", ephemeral: true });
    return;
  }

  const removed = userWarnings.splice(index, 1)[0];
  warnings[user.id] = userWarnings;
  saveWarnings(warnings);
  await interaction.reply(`Удалено предупреждение ${user.tag}: ${removed.reason}`);
}

async function handleBan(interaction) {
  if (!(await requireModerator(interaction))) return;
  const user = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true);
  const deleteDays = interaction.options.getInteger("delete_days") || 0;

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (member) {
    await sendPunishmentDm(user, {
      actionName: "бан",
      admin: interaction.user,
      reason,
      permanent: true,
    });
  }

  await interaction.guild.members.ban(user.id, { reason, deleteMessageSeconds: deleteDays * 86400 });
  await interaction.reply(`Пользователь ${user.tag} забанен. Причина: ${reason}`);
}

async function handleUnban(interaction) {
  if (!(await requireModerator(interaction))) return;
  const userId = interaction.options.getString("user_id", true);
  const reason = interaction.options.getString("reason") || "Unban by moderator";
  await interaction.guild.members.unban(userId, reason);
  await interaction.reply(`Пользователь ${userId} разбанен.`);
}

async function handleLock(interaction) {
  if (!(await requireModerator(interaction))) return;
  await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
  await interaction.reply("Канал закрыт для @everyone.");
}

async function handleUnlock(interaction) {
  if (!(await requireModerator(interaction))) return;
  await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
  await interaction.reply("Канал снова открыт для @everyone.");
}

async function handleSlowmode(interaction) {
  if (!(await requireModerator(interaction))) return;
  const seconds = interaction.options.getInteger("seconds", true);
  await interaction.channel.setRateLimitPerUser(seconds, `Slowmode set by ${interaction.user.tag}`);
  await interaction.reply(seconds === 0 ? "Медленный режим выключен." : `Медленный режим: ${seconds} сек.`);
}

async function handleVerifyButton(interaction) {
  await interaction.member.roles.add(CONFIG.verifiedRoleId, "RelicCraft verification");
  if (CONFIG.unverifiedRoleId) {
    await interaction.member.roles.remove(CONFIG.unverifiedRoleId, "RelicCraft verification").catch(() => null);
  }
  await interaction.reply({ content: "Готово! Ты прошел верификацию.", ephemeral: true });
}

async function sweepExpiredPunishments() {
  const now = Date.now();
  const punishments = loadPunishments();
  const active = [];

  for (const punishment of punishments) {
    if (!punishment.endsAt || punishment.endsAt > now) {
      active.push(punishment);
      continue;
    }

    const guild = await client.guilds.fetch(punishment.guildId).catch(() => null);
    const member = guild ? await guild.members.fetch(punishment.userId).catch(() => null) : null;
    if (member && punishment.type === "mute") {
      await member.roles.remove(CONFIG.muteRoleId, "Mute expired").catch(() => null);
    }
  }

  savePunishments(active);
}

client.once(Events.ClientReady, async () => {
  console.log(`Relic-Bot is online as ${client.user.tag}`);
  await sweepExpiredPunishments();
  await updateMinecraftStatus();
  setInterval(() => sweepExpiredPunishments().catch(console.error), 60_000);
  setInterval(() => updateMinecraftStatus().catch(console.error), CONFIG.minecraftStatusIntervalMs);
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (!CONFIG.unverifiedRoleId) return;
  await member.roles.add(CONFIG.unverifiedRoleId, "New member joined RelicCraft").catch(console.error);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    const deleted = await handleAutoModeration(message);
    if (!deleted) await handleXp(message);
  } catch (error) {
    console.error(error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton() && interaction.customId === "relic_verify") {
      await handleVerifyButton(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const handlers = {
      "verify-panel": handleVerifyPanel,
      kick: handleKick,
      timeout: handleTimeout,
      mute: handleMute,
      unmute: handleUnmute,
      blacklist: handleBlacklist,
      unblacklist: handleUnblacklist,
      clear: handleClear,
      rank: handleRank,
      "ранг": handleRank,
      warn: handleWarn,
      warnings: handleWarnings,
      unwarn: handleUnwarn,
      ban: handleBan,
      unban: handleUnban,
      lock: handleLock,
      unlock: handleUnlock,
      slowmode: handleSlowmode,
    };

    const handler = handlers[interaction.commandName];
    if (handler) await handler(interaction);
  } catch (error) {
    console.error(error);
    const message = error.message || "Что-то пошло не так.";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true }).catch(() => null);
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => null);
    }
  }
});

ensureConfig();
registerCommands()
  .then(() => client.login(CONFIG.token))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
