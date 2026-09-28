const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Membuat bot bergabung ke voice channel kamu'),

    async execute(interaction) {
        // 1. Cek apakah pengguna yang memberi perintah sedang berada di voice channel
        const voiceChannel = interaction.member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply({
                content: '❌ Kamu harus bergabung ke voice channel terlebih dahulu sebelum menggunakan perintah ini!',
                ephemeral: true
            });
        }

        // 2. Cek apakah bot punya izin untuk bergabung
        const permissions = voiceChannel.permissionsFor(interaction.client.user);
        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            return interaction.reply({
                content: '❌ Aku tidak punya izin untuk bergabung atau berbicara di voice channel itu!',
                ephemeral: true
            });
        }

        // 3. Bergabung ke voice channel
        try {
            joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            });

            await interaction.reply(`✅ Berhasil bergabung ke voice channel **${voiceChannel.name}**!`);
        } catch (error) {
            console.error(error);
            await interaction.reply({
                content: '❌ Terjadi error saat mencoba bergabung ke voice channel.',
                ephemeral: true
            });
        }
    }
};
