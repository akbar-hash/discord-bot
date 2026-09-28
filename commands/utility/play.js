const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder,
} = require('discord.js');
const {
    AudioPlayerStatus,
    NoSubscriberBehavior,
    createAudioPlayer,
    createAudioResource,
    getVoiceConnection,
    joinVoiceChannel,
    entersState,
    StreamType,
    VoiceConnectionStatus,
} = require('@discordjs/voice');
const play = require('play-dl');
const ytdl = require('@distube/ytdl-core');
const { Innertube } = require('youtubei.js');
const youtubeDl = require('youtube-dl-exec');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { spawn } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');

process.env.FFMPEG_PATH = ffmpegPath;

// === CEK ENCODER OPUS ===
try {
    require('@discordjs/opus');
    console.log('✅ Encoder: @discordjs/opus');
} catch (e) {
    try {
        require('opusscript');
        console.log('✅ Encoder: opusscript');
    } catch (e2) {
        console.log('❌ Tidak ada encoder Opus! Suara tidak akan keluar.');
    }
}

const queues = new Map();

const MAX_PLAYLIST_SIZE = 50;
let youtubeClientPromise;

function playbackControls() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('music_pause')
            .setLabel('Pause / Resume')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_skip')
            .setLabel('Skip')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('music_stop')
            .setLabel('Stop')
            .setStyle(ButtonStyle.Danger),
    );
}

function trackLabel(track) {
    return track.artist ? `${track.title} - ${track.artist}` : track.title;
}

function normalizeUrl(value) {
    if (typeof value === 'string') return value.trim().replace(/^<|>$/g, '');
    if (value && typeof value === 'object') {
        return String(value.url || value.shortUrl || '').trim().replace(/^<|>$/g, '');
    }
    return '';
}

function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function isYouTubeUrl(value) {
    try {
        const hostname = new URL(value).hostname.toLowerCase();
        return hostname === 'youtube.com'
            || hostname.endsWith('.youtube.com')
            || hostname === 'youtu.be';
    } catch {
        return false;
    }
}

function youtubeVideoId(source) {
    const url = new URL(source);
    return url.hostname === 'youtu.be'
        ? url.pathname.slice(1)
        : url.searchParams.get('v');
}

async function getYoutubeAudioStream(source) {
    youtubeClientPromise ??= Innertube.create({ client_type: 'ANDROID' });
    const youtube = await youtubeClientPromise;
    const videoId = youtubeVideoId(source);
    const format = await youtube.getStreamingData(videoId, {
        type: 'audio',
        quality: 'best',
    });
    const response = await fetch(format.url);
    if (!response.ok || !response.body) {
        throw new Error(`Gagal mengunduh stream YouTube: HTTP ${response.status}`);
    }
    const stream = Readable.fromWeb(response.body);
    const mimeType = format.mime_type || format.mimeType || '';

    return {
        stream,
        type: mimeType.includes('audio/webm') && mimeType.includes('opus')
            ? StreamType.WebmOpus
            : StreamType.Arbitrary,
    };
}

async function getYtDlpAudioStream(source) {
    const outputPath = path.join(
        os.tmpdir(),
        `discord-bot-${Date.now()}-${Math.random().toString(16).slice(2)}.webm`,
    );

    await youtubeDl(source, {
        format: 'bestaudio[ext=webm][acodec=opus]/bestaudio/best',
        output: outputPath,
        noPlaylist: true,
        quiet: true,
        noWarnings: true,
    });

    const fileInfo = await fs.stat(outputPath);
    console.log(`🎧 File audio yt-dlp: ${fileInfo.size} byte`);
    if (fileInfo.size === 0) throw new Error('yt-dlp menghasilkan file audio kosong.');

    const ffmpeg = spawn(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error',
        '-i', outputPath,
        '-vn', '-acodec', 'pcm_s16le',
        '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    ffmpeg.stderr.on('data', (chunk) => {
        console.warn(`⚠️ FFmpeg: ${chunk.toString().trim()}`);
    });
    ffmpeg.on('error', (error) => {
        console.error('❌ FFmpeg gagal dijalankan:', error.message);
    });

    return {
        stream: ffmpeg.stdout,
        type: StreamType.Raw,
        cleanup: () => {
            ffmpeg.kill();
            return fs.unlink(outputPath).catch(() => {});
        },
    };
}

async function getAudioStream(source) {
    if (isYouTubeUrl(source)) {
        console.warn('⚠️ YouTube: memakai yt-dlp + FFmpeg PCM.');
        return getYtDlpAudioStream(source);
    }

    try {
        return await play.stream(source, {
            quality: 2,
            discordPlayerCompatibility: true,
        });
    } catch (error) {
        if (!isYouTubeUrl(source)) throw error;

        try {
            console.warn('⚠️ play-dl gagal, memakai fallback YouTube Innertube.');
            return await getYoutubeAudioStream(source);
        } catch (youtubeError) {
            console.warn(`⚠️ Innertube gagal: ${youtubeError.message}`);
            try {
                console.warn('⚠️ Memakai fallback yt-dlp.');
                return getYtDlpAudioStream(source);
            } catch (ytDlpError) {
                console.warn(`⚠️ yt-dlp gagal: ${ytDlpError.message}`);
                const info = await ytdl.getInfo(source);
                const format = ytdl.chooseFormat(info.formats, {
                    quality: 'highestaudio',
                    filter: 'audioonly',
                });

                if (!format) throw youtubeError;

                const isWebmOpus = format.container === 'webm'
                    && format.codecs?.includes('opus');
                return {
                    stream: ytdl.downloadFromInfo(info, { format }),
                    type: isWebmOpus ? StreamType.WebmOpus : StreamType.Arbitrary,
                };
            }
        }
    }
}

async function spotifyTracks(url) {
    const item = await play.spotify(url);
    const tracks = item.type === 'playlist' || item.type === 'album'
        ? await item.all_tracks()
        : [item];

    return tracks.slice(0, MAX_PLAYLIST_SIZE).map((track) => ({
        title: track.name,
        artist: track.artists?.map((artist) => artist.name).join(', '),
        // HANYA simpan 'search', jangan simpan URL palsu
        search: `${track.name} ${track.artists?.[0]?.name || ''}`.trim(),
    }));
}

async function resolveTracks(query) {
    query = String(query || '').trim();
    if (!query) return [];

    const url = normalizeUrl(query);
    let source = null;
    if (isHttpUrl(url)) {
        try {
            source = play.validate(url);
        } catch {
            source = null;
        }
    }

    if (source === 'sp_track' || source === 'sp_playlist' || source === 'sp_album') {
        return spotifyTracks(url);
    }

    if (source === 'yt_playlist') {
        const playlist = await play.playlist_info(url);
        const videos = await playlist.all_videos();
        return videos.slice(0, MAX_PLAYLIST_SIZE).map((video) => ({
            title: video.title,
            url: normalizeUrl(video),
        }));
    }

    if (source === 'yt_video' || source === 'so_track') {
        return [{ title: url, url }];
    }

    if (isHttpUrl(url)) {
        return [{ title: url, url }];
    }

    const results = await play.search(query, { limit: 1 });
    if (!results.length) return [];

    return [{ title: results[0].title, url: normalizeUrl(results[0]) }];
}

async function playNext(guildId) {
    const queue = queues.get(guildId);
    if (!queue || queue.playing) return;

    const track = queue.tracks.shift();
    if (!track) {
        return false;
    }

    queue.playing = true;
    queue.current = track;

    try {
        let source = normalizeUrl(track.url);

        if (!source) {
            if (!track.search) {
                throw new Error(`Tidak ada URL atau query pencarian untuk ${trackLabel(track)}`);
            }
            const searchResults = await play.search(track.search, { limit: 1 });
            if (!searchResults.length) {
                throw new Error(`Lagu tidak ditemukan di YouTube: ${track.search}`);
            }
            source = normalizeUrl(searchResults[0]);
        }

        if (!isHttpUrl(source)) {
            throw new Error(`URL tidak valid: ${source}`);
        }

   
        // Gunakan play-dl untuk SEMUA sumber
        const stream = await getAudioStream(source);
        console.log('🎵 Audio stream berhasil didapat, tipe:', stream.type);
        queue.cleanup = stream.cleanup;
        queue.player.play(createAudioResource(stream.stream, { inputType: stream.type }));

        return true;
    } catch (error) {
        console.error(`Gagal memutar track (${normalizeUrl(track.url) || track.search}):`, error.stack || error.message);
        queue.playing = false;
        queue.current = null;

        if (queue.tracks.length > 0) {
            return playNext(guildId);
        }
        return false;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Memutar lagu dari URL atau pencarian YouTube/Spotify')
        .addStringOption((option) => option
            .setName('query')
            .setDescription('Link lagu/playlist atau judul lagu')
            .setRequired(true)),

    async handleButton(interaction) {
        const queue = queues.get(interaction.guildId);
        if (!queue) {
            return interaction.reply({ content: 'Tidak ada lagu yang sedang diputar.', ephemeral: true });
        }

        if (interaction.customId === 'music_pause') {
            if (queue.player.state.status === AudioPlayerStatus.Paused) {
                queue.player.unpause();
                return interaction.reply('▶️ Lagu dilanjutkan.');
            }
            queue.player.pause();
            return interaction.reply('⏸️ Lagu dijeda.');
        }

        if (interaction.customId === 'music_skip') {
            queue.skipRequested = true;
            queue.player.stop(true);
            return interaction.reply('⏭️ Lagu dilewati.');
        }

        queue.stopRequested = true;
        queue.tracks.length = 0;
        queue.player.stop(true);
        queue.connection.destroy();
        queues.delete(interaction.guildId);
        return interaction.reply('⏹️ Pemutaran dihentikan.');
    },

    async execute(interaction) {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            return interaction.reply({
                content: '❌ Kamu harus masuk voice channel terlebih dahulu.',
                ephemeral: true,
            });
        }

        const permissions = voiceChannel.permissionsFor(interaction.client.user);
        if (!permissions?.has('Connect') || !permissions.has('Speak')) {
            return interaction.reply({
                content: '❌ Aku tidak punya izin Connect dan Speak di voice channel itu.',
                ephemeral: true,
            });
        }

        await interaction.deferReply();

        try {
            const tracks = await resolveTracks(interaction.options.getString('query'));
            if (!tracks.length) {
                return interaction.editReply('❌ Lagu tidak ditemukan.');
            }

            let queue = queues.get(interaction.guild.id);
            if (!queue) {
                const player = createAudioPlayer({
                    behaviors: { noSubscriber: NoSubscriberBehavior.Stop },
                });
                const currentConnection = getVoiceConnection(interaction.guild.id);
                let connection = currentConnection
                    && currentConnection.joinConfig.channelId === voiceChannel.id
                    && currentConnection.state.status === VoiceConnectionStatus.Ready
                    ? currentConnection
                    : joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: interaction.guild.id,
                        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                        selfDeaf: false,
                    });
                if (currentConnection && connection !== currentConnection) {
                    currentConnection.destroy();
                }
                connection.on('stateChange', (oldState, newState) => {
                    console.log(`🔊 Voice: ${oldState.status} -> ${newState.status}`);
                });
                connection.on('error', (error) => {
                    console.error('❌ Voice connection error:', error.stack || error.message);
                });
                connection.on('debug', (message) => {
                    console.debug(`🔎 Voice debug: ${message}`);
                });

                try {
                    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
                } catch (error) {
                    connection.destroy();
                    queues.delete(interaction.guild.id);
                    throw new Error(`Koneksi voice gagal handshake: ${error.message}`);
                }

                queue = { connection, player, tracks: [], playing: false, current: null };
                const subscription = connection.subscribe(player);
                console.log(`🔊 Voice saat subscribe: ${connection.state.status}`);
                console.log(`🔊 Subscription aktif: ${Boolean(subscription)}`);
                player.on('stateChange', (oldState, newState) => {
                    console.log(`🎚️ Player: ${oldState.status} -> ${newState.status}`);
                });
                player.on(AudioPlayerStatus.Idle, () => {
                    const cleanup = queue.cleanup;
                    queue.cleanup = null;
                    cleanup?.();
                    if (queue.stopRequested) {
                        queue.stopRequested = false;
                        queue.playing = false;
                        queue.current = null;
                        return;
                    }
                    queue.playing = false;
                    queue.current = null;
                    playNext(interaction.guild.id).catch(console.error);
                });
                player.on('error', (error) => {
                    const cleanup = queue.cleanup;
                    queue.cleanup = null;
                    cleanup?.();
                    console.error('Audio player error:', error.message);
                    queue.playing = false;
                    queue.current = null;
                    playNext(interaction.guild.id).catch(console.error);
                });
                queues.set(interaction.guild.id, queue);
            }

            queue.tracks.push(...tracks);
            const startsImmediately = !queue.playing && !queue.current;
            const started = startsImmediately
                ? await playNext(interaction.guild.id)
                : false;

            const first = tracks[0];
            const suffix = tracks.length > 1 ? ` dan ${tracks.length - 1} lagu lainnya` : '';
            const message = startsImmediately && started
                ? `✅ Memutar **${trackLabel(first)}** sekarang${suffix}.`
                : startsImmediately
                    ? `⚠️ **${trackLabel(first)}** gagal diputar. Koneksi voice tetap aktif; coba URL atau lagu lain.`
                : `✅ Menambahkan **${trackLabel(first)}**${suffix} ke antrean.`;
            await interaction.editReply({
                content: message,
                components: [playbackControls()],
            });
        } catch (error) {
            console.error('Play command error:', error.stack || error.message);
            await interaction.editReply(`❌ Gagal memproses lagu: ${error.message}`);
        }
    },
};
