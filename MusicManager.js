const { Player, QueryType, Track } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType, MessageFlags } = require('discord.js');
const play = require('play-dl');
const yts = require('yt-search');
const { Innertube } = require('youtubei.js');
const { execSync } = require('child_process');
const path = require('path');

class MusicManager {
    constructor(client) {
        this.client = client;
        this.player = new Player(client);
        this.innertube = null;

        // Register Player Events
        this.setupPlayerEvents();
    }

    /**
     * Initialize extractors (V16 Master Bridge)
     */
    async init() {
        try {
            if (this.player.extractors.size === 0) {
                await this.player.extractors.loadMulti(DefaultExtractors);
            }

            // Initialize YouTubei.js for resilient streaming
            if (!this.innertube) {
                this.innertube = await Innertube.create().catch(e => {
                    console.warn('[INFO] YouTubei.js initial connection failed, will retry during playback:', e.message);
                    return null;
                });
            }

            console.log('✅ Music engine initialized (V16-MASTER-BRIDGE)');
        } catch (err) {
            console.error('❌ Error loading extractors:', err);
        }
    }

    setupPlayerEvents() {
        this.player.events.on('playerStart', (queue, track) => {
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
            console.error(`[STREAM ERROR] ${error.message}`);
            queue.metadata.send(`⚠️ **Playback Issue**: ${error.message}.`).catch(() => { });
        });
    }

    async play(interaction, query) {
        const channel = interaction.member.voice.channel;
        if (!channel) return interaction.editReply({ content: '❌ You must be in a voice channel!' }).catch(() => { });

        if (this.player.extractors.size === 0) await this.init();

        try {
            console.log(`[SEARCH] play-dl query: "${query}"`);

            // Search with play-dl (Very reliable, until it breaks)
            let youtubeResults = [];
            try {
                youtubeResults = await play.search(query, {
                    limit: 25,
                    source: { youtube: 'video' }
                });
            } catch (searchError) {
                console.warn('[SEARCH FAIL] play-dl search failed, falling back to yt-search:', searchError.message);
                const fallbackResults = await yts(query);
                youtubeResults = fallbackResults.videos.slice(0, 25).map(v => ({
                    title: v.title,
                    url: v.url,
                    link: v.url,
                    thumbnails: [{ url: v.thumbnail || v.image }],
                    durationRaw: v.timestamp,
                    views: v.views,
                    channel: { name: v.author?.name || 'Unknown' }
                }));
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
                .setPlaceholder('Choose the correct song (top 25 results)...')
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
                const video = youtubeResults[parseInt(i.values[0])];
                const videoUrl = video.url || video.link;

                if (!videoUrl) {
                    console.error('[CRITICAL] No URL found for selected video:', video);
                    return i.update({ content: `❌ **Error**: Could not find a valid URL for this track.`, components: [] }).catch(() => { });
                }

                try {
                    await i.update({ content: `✅ Processing: **${video.title}**`, components: [] }).catch(() => { });

                    // --- V16 MASTER BRIDGE: Manual Track injection ---
                    const videoInfo = await play.video_basic_info(videoUrl).catch((err) => {
                        console.warn('[INFO FAIL] video_basic_info failed, using search data:', err.message);
                        return null;
                    });

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

                    // Kick off playback using the manually created track
                    await this.player.play(channel, manualTrack, {
                        nodeOptions: {
                            metadata: interaction.channel,
                            selfDeaf: true,
                            volume: 80,
                            leaveOnEmpty: true,
                            leaveOnEnd: true,
                            // Definitve Bridge Bridge (Nuclear Extraction V2)
                            onBeforeCreateStream: async (track) => {
                                try {
                                    if (!track.url || track.url === 'undefined') {
                                        console.error('[BRIDGE FAIL] track.url is invalid:', track.url);
                                        return null;
                                    }

                                    console.log(`[BRIDGE] Nuclear Extraction for: ${track.url}`);

                                    try {
                                        const videoId = track.url.split('v=')[1]?.split('&')[0];
                                        if (!videoId) throw new Error('Could not parse video ID');

                                        // Ensure YouTubei is initialized
                                        if (!this.innertube) {
                                            this.innertube = await Innertube.create().catch(() => null);
                                        }

                                        if (this.innertube) {
                                            // Client Rotation: Try different clients as some are less restricted
                                            const clients = ['TV_EMBEDDED', 'WEB_REMIX', 'ANDROID_TESTSUITE', 'MWEB'];
                                            for (const clientName of clients) {
                                                try {
                                                    console.log(`[BRIDGE] Attempting ${clientName} client...`);
                                                    const info = await this.innertube.getBasicInfo(videoId, clientName);
                                                    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
                                                    if (format && format.url) {
                                                        console.log(`[BRIDGE SUCCESS] Extracted via ${clientName}`);
                                                        return format.url;
                                                    }
                                                } catch (clErr) {
                                                    continue;
                                                }
                                            }
                                        }
                                        throw new Error('All YouTubei.js clients failed');

                                    } catch (tubeErr) {
                                        console.warn('[BRIDGE FAIL] YouTubei rotation failed, final attempt via yt-dlp:', tubeErr.message);

                                        // FINAL FALLBACK: yt-dlp with advanced bypass args
                                        const isWindows = process.platform === 'win32';
                                        const ytDlpPath = isWindows ? path.join(__dirname, 'yt-dlp.exe') : 'yt-dlp';

                                        // Use specific player client arguments to bypass blocks
                                        const extractorArgs = '--extractor-args "youtube:player_client=android,ios" --no-check-certificates';

                                        const command = isWindows
                                            ? `"${ytDlpPath}" ${extractorArgs} -g -f bestaudio "${track.url}"`
                                            : `yt-dlp ${extractorArgs} -g -f bestaudio "${track.url}"`;

                                        const directUrl = execSync(command).toString().trim();

                                        if (directUrl && directUrl.startsWith('http')) {
                                            console.log('[BRIDGE SUCCESS] yt-dlp final bypass worked');
                                            return directUrl;
                                        }
                                        throw new Error('All extraction methods blocked by YouTube');
                                    }
                                } catch (e) {
                                    console.error('[BRIDGE FAIL FINAL]', e.message);
                                    // Fallback to play-dl as last resort
                                    try {
                                        const stream = await play.stream(track.url, { discordPlayerCompatibility: true });
                                        return stream.stream;
                                    } catch (innerErr) {
                                        return null;
                                    }
                                }
                            }
                        }
                    });
                } catch (playErr) {
                    console.error('[PLAY ERR]', playErr);
                    interaction.channel.send(`❌ **Engine Error**: ${playErr.message}`).catch(() => { });
                }
            });

            collector.on('end', (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    interaction.editReply({ content: '❌ Search timed out.', components: [] }).catch(() => { });
                }
            });

        } catch (error) {
            console.error('[SYSTEM ERROR]', error);
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
