require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('music')
        .setDescription('Search and play music from YouTube')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('The name of the song to search for')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause the music'),
    new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume the music'),
    new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip to the next song'),
    new SlashCommandBuilder()
        .setName('next')
        .setDescription('Switch to the next song'),
    new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop music and clear queue'),
    new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show current queue'),
    new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Disconnect the bot'),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('🚀 Deploying discord-player slash commands...');

        // Use client ID from previous interactions
        const clientId = '1474455602292850881';

        await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands },
        );

        console.log('✅ Commands Deployed Successfully!');
    } catch (error) {
        console.error('❌ Error deploying commands:', error);
    }
})();
