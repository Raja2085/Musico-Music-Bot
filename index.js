require('dotenv').config();
const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const MusicManager = require('./MusicManager');
const net = require('net');
const path = require('path');

// --- FFMPEG DYNAMIC PATH ---
try {
    const ffmpegPath = require('ffmpeg-static');
    const ffmpegDir = path.dirname(ffmpegPath);
    process.env.PATH = `${ffmpegDir};${process.env.PATH}`;
    console.log('✅ FFMPEG found and injected into PATH');
} catch (e) {
    console.warn('⚠️ Could not find ffmpeg-static, ensure ffmpeg is in your system PATH');
}

// --- GLOBAL ERROR HANDLERS ---
process.on('uncaughtException', (err) => {
    console.error('🔥 [UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 [UNHANDLED REJECTION]', reason);
});

// --- SINGLE INSTANCE LOCK ---
const LOCK_PORT = 9999;
const server = net.createServer();

server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error('\n🛑 [FATAL ERROR] ANOTHER BOT INSTANCE IS ALREADY RUNNING!');
        console.error('🛑 PLEASE STOP ALL OTHER "node index.js" TERMINALS BEFORE STARTING THIS ONE.');
        console.error('🛑 TIP: Use "./reset.ps1" to kill all old bot processes.\n');
        process.exit(1);
    }
});

server.listen(LOCK_PORT, () => {
    console.log(`🔒 [INSTANCE LOCK] Secured on port ${LOCK_PORT}`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const musicManager = new MusicManager(client);

client.once(Events.ClientReady, async (readyClient) => {
    console.log(`🚀 Hardened Music Bot (V15) is ONLINE as ${readyClient.user.tag}`);
    try {
        await musicManager.init();
        console.log('--- READY FOR COMMANDS ---');
        setInterval(() => console.log('💓 Heartbeat: Bot is healthy.'), 60000);
    } catch (err) {
        console.error('❌ Failed to initialize Music Manager:', err);
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options } = interaction;

    try {
        // --- ZERO-TIMEOUT POLICY ---
        // Defer EVERY chat command immediately as the very first operation.
        // This gives us 15 minutes of response time for every action.
        await interaction.deferReply().catch(() => { });

        switch (commandName) {
            case 'music':
                await musicManager.play(interaction, options.getString('name'));
                break;
            case 'pause':
                await musicManager.pause(interaction);
                break;
            case 'resume':
                await musicManager.resume(interaction);
                break;
            case 'skip':
            case 'next':
                await musicManager.skip(interaction);
                break;
            case 'stop':
                await musicManager.stop(interaction);
                break;
            case 'queue':
                await musicManager.showQueue(interaction);
                break;
            case 'leave':
                musicManager.stop(interaction);
                const conn = require('@discordjs/voice').getVoiceConnection(interaction.guildId);
                if (conn) {
                    conn.destroy();
                    await interaction.editReply('👋 Goodbye!');
                } else {
                    await interaction.editReply('I am not in a channel!');
                }
                break;
        }
    } catch (error) {
        console.error('[Interaction Error]', error);
        const errorMessage = `❌ **Error**: ${error.message}`;
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: errorMessage }).catch(() => { });
            } else {
                await interaction.reply({ content: errorMessage, flags: [MessageFlags.Ephemeral] }).catch(() => { });
            }
        } catch (err) {
            console.error('[FATAL] Response failed:', err.message);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
