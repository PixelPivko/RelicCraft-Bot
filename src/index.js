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
};

const DATA_DIR = path.join(__dirname, "..", "data");
const PUNISHMENTS_FILE = path.join(DATA_DIR, "punishments.json");
const STATUS_MESSAGE_FILE = path.join(DATA_DIR, "minecraft-status-message.json");
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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
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
