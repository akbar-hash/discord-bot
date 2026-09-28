const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

// Kumpulkan semua command dari folder commands
const commands = [];
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        
        if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
        } else {
            console.log(`[WARNING] Command di ${filePath} tidak memiliki properti "data" atau "execute".`);
        }
    }
}

// Buat instance REST
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Daftarkan command ke guild spesifik (untuk testing)
// Ganti GUILD_ID dengan ID server Discord kamu
const GUILD_ID = '979711260868350032';
const CLIENT_ID = '1549984902303318067';

(async () => {
    try {
        console.log(`Memulai pendaftaran ${commands.length} slash command...`);

        // Daftarkan ke guild spesifik (langsung muncul, cocok untuk testing)
        const data = await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands }
        );

        console.log(`Berhasil mendaftarkan ${data.length} slash command!`);
    } catch (error) {
        console.error(error);
    }
})();