// Import library yang dibutuhkan
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const cors = require('cors');
const FileType = require('file-type');
const { URL } = require('url');

// Inisialisasi aplikasi Express
const app = express();
const PORT = process.env.PORT || 3000;

// Definisikan prompt untuk setiap style
const stylePrompts = {
    'ghibli': 'Ubah gambar berikut menjadi seperti style studio ghibli dengan mempertahankan detail dan original gambar.',
    'pixar': 'Ubah tekstur gambar ini agar seperti ilustrasi Pixar, tanpa mengubah bentuk atau susunan objek aslinya.',
    'simpson': 'Ubah tekstur gambar ini agar seperti ilustrasi The Simpson, tanpa mengubah bentuk atau susunan objek aslinya'
};

const validSizes = ['1024x1024', '1536x1024', '1024x1536'];

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

/**
 * Fungsi untuk generate gambar, menggunakan axios.
 */
const generateArtImage = async (imageBuffer, prompt, size) => {
    if (!imageBuffer) throw new Error("Image buffer is required.");
    if (!prompt) throw new Error("Prompt is required.");
    if (!size) throw new Error("Size is required.");

    const fileInfo = await FileType.fromBuffer(imageBuffer);
    if (!fileInfo) {
        throw new Error("Could not determine the file type of the uploaded image.");
    }
    const { ext, mime } = fileInfo;

    const form = new FormData();
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('n', '1');
    form.append('is_enhance', "true");
    form.append('image', imageBuffer, {
        filename: `image.${ext}`,
        contentType: mime,
    });

    try {
        const response = await axios.post('https://gpt1image.exomlapi.com/v1/images/generations', form, {
            headers: {
                ...form.getHeaders(),
                "referer": "https://gpt1image.exomlapi.com/",
                "user-agent": "Mozilla/5.0"
            }
        });

        const json = response.data;
        if (!json?.data || json.data.length === 0 || !json.data[0].url) {
            const apiMessage = json.message || 'No image URL was returned.';
            throw new Error(`External API response was invalid. Message: ${apiMessage}`);
        }
        return json.data[0].url;
    } catch (error) {
        if (error.response) {
            throw new Error(`External API Error: ${error.response.statusText}. Details: ${JSON.stringify(error.response.data)}`);
        }
        throw error;
    }
};

// Endpoint untuk halaman utama
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint Proxy untuk Gambar
app.get('/proxy-image/*', async (req, res) => {
    try {
        const imagePath = req.params[0];
        const externalUrl = `https://anondrop.net/${imagePath}`;

        const imageResponse = await axios.get(externalUrl, {
            responseType: 'arraybuffer'
        });

        const imageBuffer = Buffer.from(imageResponse.data, 'binary');
        const fileInfo = await FileType.fromBuffer(imageBuffer);
        
        if (fileInfo) {
            res.setHeader('Content-Type', fileInfo.mime);
        }
        
        res.send(imageBuffer);

    } catch (error) {
        console.error("Proxy Error:", error.message);
        res.status(500).send("Failed to proxy image.");
    }
});

// Endpoint Generate sekarang membuat URL proxy
app.post('/generate', upload.single('image'), async (req, res) => {
    try {
        const { style, size } = req.body;
        const imageFile = req.file;

        if (!imageFile) return res.status(400).json({ error: 'No image file uploaded.' });
        if (!style || !stylePrompts[style]) return res.status(400).json({ error: 'Invalid style.' });
        if (!size || !validSizes.includes(size)) return res.status(400).json({ error: 'Invalid size.' });

        const prompt = stylePrompts[style];
        console.log(`Image received. Style: ${style}, Size: ${size}. Forwarding to external API...`);
        
        const externalImageUrl = await generateArtImage(imageFile.buffer, prompt, size);
        console.log("Successfully generated external URL:", externalImageUrl);

        const urlObject = new URL(externalImageUrl);
        const imagePath = urlObject.pathname;
        const proxyUrl = `/proxy-image${imagePath}`;

        console.log(`Created proxy URL: ${proxyUrl}`);
        
        res.json({ imageUrl: proxyUrl });

    } catch (error) {
        console.error('Error in /generate endpoint:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Jalankan server
// PERBAIKAN: Menambahkan '0.0.0.0' agar bisa diakses oleh Railway
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
