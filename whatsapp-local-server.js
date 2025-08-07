// whatsapp-local-server.js
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

client.on('qr', qr => {
    console.log('Escanea este código QR:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Cliente de WhatsApp está listo');
});

client.initialize();

app.get('/', (req, res) => {
    res.send('Hola')
})

// Endpoint para enviar mensajes desde el servidor de Render
app.post('/send-message', async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) {
        return res.status(400).json({ error: 'Faltan campos' });
    }

    try {
        const chatId = `${phone}@c.us`;
        await client.sendMessage(chatId, message);
        res.json({ success: true, to: phone });
    } catch (err) {
        console.error('❌ Error enviando mensaje:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.listen(3001, () => {
    console.log('🟢 Servidor local de WhatsApp corriendo en http://localhost:3001');
});
