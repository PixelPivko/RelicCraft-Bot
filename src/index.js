require("dotenv").config();

const {
  ActionRowBuilder,
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
const path = require("node:path");

const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  moderatorRoleId: process.env.MODERATOR_ROLE_ID || "1524825124019241011",
  verifiedRoleId: process.env.VERIFIED_ROLE_ID,
  unverifiedRoleId: process.env.UNVERIFIED_ROLE_ID,
  muteRoleId: process.env.MUTE_ROLE_ID,
  blacklistRoleId: process.env.BLACKLIST_ROLE_ID,
  verifyChannelId: process.env.VERIFY_CHANNEL_ID,
  appealUrl: process.env.APPEAL_URL || "https://discord.gg/CYJ4bfTYMN",
};

const DATA_DIR = path.join(__dirname, "..", "data");
const PUNISHMENTS_FILE = path.join(DATA_DIR, "punishments.json");

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
      .setLabel("Верифицироваться")
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
    .setColor(0x2ecc71)
    .setTitle("RelicCraft | Верификация")
    .setDescription("Нажми кнопку ниже, чтобы получить доступ к серверу.");

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
  setInterval(() => sweepExpiredPunishments().catch(console.error), 60_000);
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
