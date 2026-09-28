require('dotenv').config();
const { Client, GatewayIntentBits, Events, Collection } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const fs = require('node:fs');
const path = require('node:path');

// === KONFIGURASI VOICE CHANNEL 24/7 ===
const GUILD_ID = '979711260868350032';
const VOICE_CHANNEL_ID = '979711260868350037';

// === 1. Inisialisasi Client ===
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates 
    ]
});

// === 2. Muat Semua File Command ===
client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);

        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING] Command di ${filePath} tidak memiliki properti "data" atau "execute".`);
        }
    }
}

// === 3. Inisialisasi Map untuk menyimpan status AFK ===
client.afkUsers = new Map();

// === 4. Fungsi Helper untuk Bergabung ke Voice Channel ===
function connectToVoice(guild) {
    const voiceChannel = guild.channels.cache.get(VOICE_CHANNEL_ID);
    if (!voiceChannel) {
        console.error('Voice channel tidak ditemukan! Periksa VOICE_CHANNEL_ID.');
        return;
    }

    try {
        joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
        });
        console.log(`✅ Bot bergabung ke voice channel: ${voiceChannel.name}`);
    } catch (error) {
        console.error('❌ Gagal bergabung ke voice channel:', error);
    }
}

// === 5. Event saat Bot Online ===
client.once(Events.ClientReady, async (c) => {
    console.log(`🤖 Bot siap! Login sebagai ${c.user.tag}`);

});

// === 6. Event untuk Menangani Slash Command ===
client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton()) {
        const command = interaction.client.commands.get('play');
        if (command?.handleButton) {
            try {
                await command.handleButton(interaction);
            } catch (error) {
                console.error('Button interaction error:', error);
                if (!interaction.replied) {
                    await interaction.reply({ content: 'Gagal menjalankan kontrol musik.', ephemeral: true });
                }
            }
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`Command ${interaction.commandName} tidak ditemukan.`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'Terjadi error saat menjalankan command ini!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'Terjadi error saat menjalankan command ini!', ephemeral: true });
        }
    }
});

// === 7. Event untuk Menangani Pesan (AFK & Balasan Halo) ===
client.on(Events.MessageCreate, (message) => {
    if (message.author.bot) return;

    // --- Fitur AFK: Hapus status AFK jika pengguna mengirim pesan ---
    if (client.afkUsers.has(message.author.id)) {
        client.afkUsers.delete(message.author.id);
        message.reply(`👋 Selamat datang kembali, ${message.author.username}! Status AFK kamu telah dihapus.`);
    }

    // --- Fitur AFK: Beri tahu jika ada yang me-mention pengguna yang sedang AFK ---
    if (message.mentions.members.size > 0) {
        message.mentions.members.forEach((member) => {
            if (client.afkUsers.has(member.id)) {
                const afkData = client.afkUsers.get(member.id);
                message.reply(`💤 **${member.user.username}** sedang AFK.\n**Alasan:** ${afkData.reason}`);
            }
        });
    }

    // --- Fitur Halo: Membalas sapaan "halo" ---
    if (message.content.toLowerCase() === 'halo') {
        message.reply(`Halo juga, ${message.author.username}!`);
    }
});

// === 7. Event untuk Menangani Pesan (AFK, Halo, & Filter Kata Kasar) ===
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    // --- Fitur Filter Kata Kasar ---
    const badWords = ['kontol', 'memek', 'anjing', 'asu', 'bangsat', 'tai', 'bangke', 'bego', 'tolol', 'goblok', 'sundel', 'ubek', 'ngentot', 'basong'];
    const containsBadWord = badWords.some(word => message.content.toLowerCase().includes(word));

    if (containsBadWord) {
        try {
            // Hapus pesan
            await message.delete().catch(err => console.log('Gagal menghapus pesan (mungkin sudah dihapus):', err.message));
            
            // Kirim peringatan ke channel (BUKAN reply)
            await message.channel.send(`⚠️ ${message.author.username}, jangan berkata kasar ya!`);
        } catch (error) {
            console.error('Error saat memproses filter kata kasar:', error);
        }
        return; // Hentikan proses agar tidak lanjut ke fitur lain
    }

    // --- Fitur AFK: Hapus status AFK jika pengguna mengirim pesan ---
    if (client.afkUsers.has(message.author.id)) {
        client.afkUsers.delete(message.author.id);
        message.reply(`👋 Selamat datang kembali, ${message.author.username}! Status AFK kamu telah dihapus.`);
    }

    // --- Fitur AFK: Beri tahu jika ada yang me-mention pengguna yang sedang AFK ---
    if (message.mentions.members.size > 0) {
        message.mentions.members.forEach((member) => {
            if (client.afkUsers.has(member.id)) {
                const afkData = client.afkUsers.get(member.id);
                message.reply(`💤 **${member.user.username}** sedang AFK.\n**Alasan:** ${afkData.reason}`);
            }
        });
    }

    // --- Fitur Halo: Membalas sapaan "halo" ---
    if (message.content.toLowerCase() === 'halo' || message.content.toLowerCase() === 'halo bot') {
        message.reply(`Halo juga, ${message.author.username}!`);
    }
});

// === 8. Event untuk Memantau Status Voice (Auto-Reconnect 24/7) ===
// === 9. Login ke Discord ===
client.login(process.env.DISCORD_TOKEN);

// === 10. Penanganan Error Global (Anti-Crash) ===
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});