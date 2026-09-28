const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    // Definisi command yang akan didaftarkan ke Discord
    data: new SlashCommandBuilder()
        .setName('afk')
        .setDescription('Menandai dirimu sebagai AFK (Away From Keyboard)')
        .addStringOption(option =>
            option.setName('alasan')
                .setDescription('Alasan kamu AFK (opsional)')
                .setRequired(false)
        ),

    // Fungsi yang dijalankan saat command digunakan
    async execute(interaction) {
        const alasan = interaction.options.getString('alasan') || 'Tidak ada alasan yang diberikan';
        
        // Ambil map data AFK dari client (akan kita buat di index.js)
        const afkUsers = interaction.client.afkUsers;

        // Simpan status AFK pengguna
        afkUsers.set(interaction.user.id, {
            reason: alasan,
            timestamp: Date.now()
        });

        // Balas ke pengguna (ephemeral = hanya terlihat oleh pengguna)
        await interaction.reply({
            content: `✅ Kamu sekarang **AFK** dengan alasan: **${alasan}**`,
            ephemeral: true
        });
    }
};
