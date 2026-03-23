const { Player, QueryType, Track } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType, MessageFlags } = require('discord.js');
const play = require('play-dl');
const yts = require('yt-search');
const { execSync } = require('child_process');
const path = require('path');

class MusicManager {
    constructor(client) {
        this.client = client;
        this.player = new Player(client, {
            skipFFmpeg: false
        });
        
        // Detailed Debug Logging
        if (process.env.DEBUG_BOT === 'true') {
            this.player.on('debug', (msg) => console.log(`[PLAYER DEBUG] ${msg}`));
        }

        // Register Player Events
        this.setupPlayerEvents();

        // Pre-load extractors for faster performance
        this.init();
    }

    /**
     * Initialize extractors
     */
    async init() {
        try {
            if (this.player.extractors.size === 0) {
                await this.player.extractors.loadMulti(DefaultExtractors);
            }
            console.log('✅ Music engine initialized');
        } catch (err) {
            console.error('❌ Error loading extractors:', err);
        }
    }

    setupPlayerEvents() {
        this.player.events.on('playerStart', (queue, track) => {
            console.log(`[PLAYER] Now playing: ${track.title}`);
            const embed = new EmbedBuilder()
                .setTitle('🎶 Now Playing')
                .setDescription(`**${track.title}**`)
                .setThumbnail(track.thumbnail)
                .addFields(
                    { name: 'Duration', value: track.duration, inline: true },
                    { name: 'Requested By', value: `${track.requestedBy}`, inline: true }
                )
                .setColor('#2ecc71');
            queue.metadata.send({ embeds: [embed] }).catch(() => { });
        });

        this.player.events.on('audioTrackAdd', (queue, track) => {
            const embed = new EmbedBuilder()
                .setTitle('✅ Song Added')
                .setDescription(`**${track.title}**`)
                .setColor('#b583f7');
            queue.metadata.send({ embeds: [embed] }).catch(() => { });
        });

        this.player.events.on('emptyQueue', (queue) => {
            queue.metadata.send('👋 Queue empty, leaving the channel.').catch(() => { });
        });

        this.player.events.on('playerError', (queue, error) => {
            console.error(`❌ [PLAYER ERROR] ${error.message}`);
            queue.metadata.send(`⚠️ **Playback Issue**: ${error.message}.`).catch(() => { });
        });

        this.player.events.on('error', (queue, error) => {
            console.error(`❌ [QUEUE ERROR] ${error.message}`);
            // If it's an abort error, it's often network/voip related
            if (error.message.includes('aborted')) {
                console.warn('⚠️ [VOIP] Connection was aborted. This might be a network issue or missing Opus encoder.');
            }
        });
    }

    async play(interaction, query) {
        const channel = interaction.member.voice.channel;
        if (!channel) return interaction.editReply({ content: '❌ You must be in a voice channel!' }).catch(() => { });


        try {
            await interaction.editReply({ content: `🔍 Searching for **"${query}"**...` }).catch(() => { });

            // Search with yt-search first (more stable on Replit IPs)
            let youtubeResults = [];
            try {
                const searchRes = await yts(query);
                youtubeResults = searchRes.videos.slice(0, 10).map(v => ({
                    title: v.title,
                    url: v.url,
                    link: v.url,
                    thumbnails: [{ url: v.thumbnail || v.image }],
                    durationRaw: v.timestamp,
                    views: v.views,
                    channel: { name: v.author?.name || 'Unknown' }
                }));
            } catch (searchError) {
                console.warn('[SEARCH] yt-search failed, trying play-dl fallback:', searchError.message);
                try {
                    youtubeResults = await play.search(query, {
                        limit: 15,
                        source: { youtube: 'video' }
                    });
                } catch (playDlError) {
                    console.error('[SEARCH FAIL] Both providers failed:', playDlError.message);
                }
            }

            if (!youtubeResults || !youtubeResults.length) {
                return interaction.editReply({ content: `❌ No results found for **"${query}"**.` }).catch(() => { });
            }

            // Results Dropdown
            const selectOptions = youtubeResults.map((v, i) => ({
                label: v.title.substring(0, 100),
                description: `${v.durationRaw} | ${v.channel?.name || 'Unknown'}`.substring(0, 100),
                value: i.toString(),
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('music_select_v16')
                .setPlaceholder('Choose a song...')
                .addOptions(selectOptions);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const response = await interaction.editReply({
                content: `🔍 **YouTube Results for "${query}"**:`,
                components: [row]
            }).catch(() => { });

            if (!response) return;

            // Selection Collector
            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                time: 60000,
                filter: i => i.user.id === interaction.user.id
            });

            collector.on('collect', async i => {
                try {
                    // IMMEDIATELY defer to prevent "Interaction failed" on slow networks
                    await i.deferUpdate().catch(() => { });

                    const video = youtubeResults[parseInt(i.values[0])];
                    const videoUrl = video.url || video.link;

                    if (!videoUrl) return interaction.editReply({ content: `❌ **Error**: Invalid URL.`, components: [] }).catch(() => { });

                    await interaction.editReply({ content: `✅ Processing: **${video.title}**`, components: [] }).catch(() => { });

                    const videoInfo = await play.video_basic_info(videoUrl).catch(() => null);

                    const manualTrack = new Track(this.player, {
                        title: videoInfo?.video_details?.title || video.title,
                        description: videoInfo?.video_details?.description || '',
                        author: videoInfo?.video_details?.channel?.name || video.channel?.name || 'Unknown',
                        url: videoUrl,
                        thumbnail: videoInfo?.video_details?.thumbnails[0]?.url || video.thumbnails[0]?.url || '',
                        duration: videoInfo?.video_details?.durationRaw || video.durationRaw,
                        views: videoInfo?.video_details?.views || video.views || 0,
                        requestedBy: interaction.user,
                        source: 'youtube',
                        queryType: QueryType.YOUTUBE_VIDEO
                    });

                    // Kick off playback
                    await this.player.play(channel, manualTrack, {
                        nodeOptions: {
                            metadata: interaction.channel,
                            selfDeaf: true,
                            selfMute: false,
                            volume: 100,
                            leaveOnEmpty: true,
                            leaveOnEnd: true,
                            bufferingTimeout: 10000,
                            connectionTimeout: 120000, // 2 minute timeout for slow networks
                            // OPTIMIZED LOCAL BRIDGE
                            onBeforeCreateStream: async (track) => {
                                try {
                                    if (!track.url || track.url === 'undefined') return null;

                                    const isWindows = process.platform === 'win32';
                                    
                                    // On Local Windows, use a direct yt-dlp pipe for maximum reliability
                                    if (isWindows) {
                                        try {
                                            const cleanUrl = track.url.split('&')[0]; 
                                            console.log(`[LOCAL] Piping yt-dlp: ${track.title}`);
                                            
                                            const ytDlpPath = path.join(process.cwd(), 'yt-dlp.exe');
                                            const { spawn } = require('child_process');
                                            
                                            // Spawn yt-dlp and extract audio to stdout (-)
                                            const ytProcess = spawn(ytDlpPath, [
                                                '-o', '-', 
                                                '-q', 
                                                '--no-warnings', 
                                                '--no-playlist',
                                                '-f', 'bestaudio[ext=m4a]/bestaudio', 
                                                cleanUrl
                                            ]);

                                            // Return the stdout stream directly
                                            return ytProcess.stdout;
                                        } catch (e) {
                                            console.warn('[LOCAL PIPE FAIL]', e.message);
                                        }
                                    }

                                    // Fallback for Replit (Linux)
                                    try {
                                        const streamData = await play.stream(track.url, { discordPlayerCompatibility: true });
                                        return streamData.stream;
                                    } catch (err) {
                                        console.error('[BRIDGE FAIL]', err.message);
                                        return null;
                                    }
                                } catch (e) {
                                    console.error(`[BRIDGE FAIL] ${e.message}`);
                                    return null;
                                }
                            }
                        }
                    });
                } catch (playErr) {
                    console.error('[PLAY ERROR]', playErr.message);
                    interaction.channel.send(`❌ **Engine Error**: ${playErr.message}`).catch(() => { });
                }
            });

            collector.on('end', (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    interaction.editReply({ content: '❌ Search timed out.', components: [] }).catch(() => { });
                }
            });

        } catch (error) {
            console.error('[SYSTEM ERROR]', error.message);
            await interaction.editReply({ content: `❌ **System Error**: ${error.message}` }).catch(() => { });
        }
    }

    // Standard Controls
    async pause(i) {
        const q = this.player.nodes.get(i.guildId);
        if (!q || !q.node.isPlaying()) return i.editReply({ content: 'Nothing playing!' }).catch(() => { });
        q.node.setPaused(true); await i.editReply('⏸️ **Paused.**').catch(() => { });
    }

    async resume(i) {
        const q = this.player.nodes.get(i.guildId);
        if (!q || !q.node.isPaused()) return i.editReply({ content: 'Not paused!' }).catch(() => { });
        q.node.setPaused(false); await i.editReply('▶️ **Resumed.**').catch(() => { });
    }

    async skip(i) {
        const q = this.player.nodes.get(i.guildId);
        if (!q || !q.node.isPlaying()) return i.editReply({ content: 'Nothing to skip!' }).catch(() => { });
        q.node.skip(); await i.editReply('⏭️ **Skipped.**').catch(() => { });
    }

    async stop(i) {
        const q = this.player.nodes.get(i.guildId);
        if (!q) return i.editReply({ content: 'Nothing playing!' }).catch(() => { });
        q.delete(); await i.editReply('⏹️ **Stopped.**').catch(() => { });
    }

    async showQueue(i) {
        const q = this.player.nodes.get(i.guildId);
        if (!q || !q.currentTrack) return i.editReply({ content: 'Queue is empty!' }).catch(() => { });
        const list = q.tracks.toArray().slice(0, 5).map((t, idx) => `${idx + 1}. ${t.title}`).join('\n');
        await i.editReply({ embeds: [new EmbedBuilder().setTitle('🎶 Server Queue').setDescription(`**Now Playing**: ${q.currentTrack.title}\n\n${list}`).setColor('#7289da')] }).catch(() => { });
    }
}

module.exports = MusicManager;
