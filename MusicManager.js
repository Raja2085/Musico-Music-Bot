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
        this.player = new Player(client);

        // Register Player Events
        this.setupPlayerEvents();
    }

    /**
     * Initialize extractors
     */
    async init() {
        try {
            if (this.player.extractors.size === 0) {
                await this.player.extractors.loadMulti(DefaultExtractors);
            }
            console.log('✅ Music engine initialized (V16-LOCAL-VERBOSE)');
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
            console.log(`[QUEUE] Added track: ${track.title}`);
            const embed = new EmbedBuilder()
                .setTitle('✅ Song Added')
                .setDescription(`**${track.title}**`)
                .setColor('#b583f7');
            queue.metadata.send({ embeds: [embed] }).catch(() => { });
        });

        this.player.events.on('emptyQueue', (queue) => {
            console.log('[QUEUE] Queue is empty');
            queue.metadata.send('👋 Queue empty, leaving the channel.').catch(() => { });
        });

        this.player.events.on('playerError', (queue, error) => {
            console.error(`🔥 [PLAYER ERROR] ${error.stack || error.message}`);
            queue.metadata.send(`⚠️ **Playback Issue**: ${error.message}.`).catch(() => { });
        });

        this.player.events.on('error', (queue, error) => {
            console.error(`🔥 [GENERAL ERROR] ${error.stack || error.message}`);
        });

        this.player.events.on('debug', (queue, message) => {
            if (message.includes('Error')) console.log(`[PLAYER DEBUG] ${message}`);
        });
    }

    async play(interaction, query) {
        const channel = interaction.member.voice.channel;
        if (!channel) return interaction.editReply({ content: '❌ You must be in a voice channel!' }).catch(() => { });

        if (this.player.extractors.size === 0) await this.init();

        try {
            console.log(`[SEARCH] play-dl query: "${query}"`);

            // Search with play-dl (fallback to yt-search if it fails)
            let youtubeResults = [];
            try {
                youtubeResults = await play.search(query, {
                    limit: 25,
                    source: { youtube: 'video' }
                });
            } catch (searchError) {
                console.warn('[SEARCH FAIL] Falling back to yt-search:', searchError.message);
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
                .setCustomId('music_select_v16_verbose')
                .setPlaceholder('Choose the correct song...')
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

                if (!videoUrl) return i.update({ content: `❌ **Error**: Invalid URL.`, components: [] }).catch(() => { });

                try {
                    console.log(`[INTERACTION] User selected: ${video.title}`);
                    await i.update({ content: `✅ Processing: **${video.title}**`, components: [] }).catch(() => { });

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
                        source: 'arbitrary', // Force bridge
                        queryType: QueryType.AUTO
                    });

                    console.log(`[SYSTEM] Starting playback for: ${manualTrack.title}`);

                    // Kick off playback
                    await this.player.play(channel, manualTrack, {
                        nodeOptions: {
                            metadata: interaction.channel,
                            selfDeaf: true,
                            volume: 100,
                            leaveOnEmpty: true,
                            leaveOnEnd: true,
                            // EXTREME LOCAL BRIDGE
                            onBeforeCreateStream: async (track) => {
                                console.log(`[BRIDGE] onBeforeCreateStream triggered for: ${track.url}`);
                                try {
                                    if (!track.url || track.url === 'undefined') {
                                        console.error('[BRIDGE] FATAL: Track URL is null or undefined');
                                        return null;
                                    }

                                    const isWindows = process.platform === 'win32';
                                    const ytDlpPath = isWindows ? path.join(process.cwd(), 'yt-dlp.exe') : 'yt-dlp';

                                    console.log(`[BRIDGE] Using yt-dlp path: ${ytDlpPath}`);

                                    // Simpler command for better stability
                                    const command = isWindows
                                        ? `"${ytDlpPath}" -g -f bestaudio "${track.url}"`
                                        : `yt-dlp -g -f bestaudio "${track.url}"`;

                                    console.log(`[BRIDGE] Running command: ${command}`);

                                    try {
                                        const directUrl = execSync(command, { encoding: 'utf8', timeout: 30000 }).trim();

                                        if (directUrl && directUrl.startsWith('http')) {
                                            console.log(`[BRIDGE SUCCESS] URL length: ${directUrl.length}`);
                                            // Optional: Log a snippet of the URL for verification
                                            console.log(`[BRIDGE SUCCESS] URL snippet: ${directUrl.substring(0, 50)}...`);
                                            return directUrl;
                                        }
                                        console.error(`[BRIDGE FAIL] yt-dlp returned invalid content: ${directUrl.substring(0, 100)}`);
                                        throw new Error('yt-dlp parsing failed');
                                    } catch (execErr) {
                                        console.error(`[BRIDGE EXEC ERROR] ${execErr.message}`);
                                        if (execErr.stderr) console.error(`[BRIDGE STDERR] ${execErr.stderr.toString()}`);

                                        console.log('[BRIDGE] Falling back to play-dl directly...');
                                        const stream = await play.stream(track.url, { discordPlayerCompatibility: true });
                                        return stream.stream;
                                    }
                                } catch (e) {
                                    console.error(`🔥 [BRIDGE FATAL ERROR] ${e.stack || e.message}`);
                                    return null;
                                }
                            }
                        }
                    });
                } catch (playErr) {
                    console.error('🔥 [PLAY ACTION ERROR]', playErr.stack || playErr.message);
                    interaction.channel.send(`❌ **Engine Error**: ${playErr.message}`).catch(() => { });
                }
            });

            collector.on('end', (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    interaction.editReply({ content: '❌ Search timed out.', components: [] }).catch(() => { });
                }
            });

        } catch (error) {
            console.error('🔥 [SYSTEM ERROR]', error.stack || error.message);
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
