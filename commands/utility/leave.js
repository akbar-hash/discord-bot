const { SlashCommandBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Membuat bot keluar dari voice channel'),

    async execute(interaction) {
        const connection = getVoiceConnection(interaction.guild.id);

        if (!connection) {
            return interaction.reply({
                content: '❌ Aku tidak sedang berada di voice channel manapun.',
                ephemeral: true
            });
        }

        // Set flag agar auto-reconnect tidak aktif untuk keluar manual
        connection.destroy();

        await interaction.reply('👋 Aku telah keluar dari voice channel.');
    }
};
