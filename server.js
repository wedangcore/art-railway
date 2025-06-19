// Import library yang dibutuhkan
const express = require('express');
const multer = require('multer');
const axios = require('axios'); // PERUBAHAN: Mengganti node-fetch dengan axios
const FormData = require('form-data');
const path = require('path');
const cors = require('cors');
const FileType = require('file-type');

// Inisialisasi aplikasi Express
const app = express();
const PORT = process.env.PORT || 3000;

// Definisikan prompt untuk setiap style
const stylePrompts = {
    'ghibli': 'Ubah gambar berikut menjadi seperti style studio ghibli dengan mempertahankan detail dan original gambar.',
    'pixar': 'Ubah tekstur gambar ini agar seperti ilustrasi Pixar, tanpa mengubah bentuk atau susunan objek aslinya.',
    'simpson': 'Ubah tekstur gambar ini agar seperti ilustrasi The Simpson, tanpa mengubah bentuk atau susunan objek aslinya'
};

// Definisikan ukuran yang valid
const validSizes = ['1024x1024', '1536x1024', '1024x1536'];

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Konfigurasi Multer untuk menangani file upload di memori
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

/**
 * Fungsi untuk generate gambar, sekarang menggunakan axios.
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

    // --- PERUBAHAN: Menggunakan Axios untuk request ---
    try {
        const response = await axios.post('https://gpt1image.exomlapi.com/v1/images/generations', form, {
            headers: {
                ...form.getHeaders(),
                "referer": "https://gpt1image.exomlapi.com/",
                "user-agent": "Mozilla/5.0"
            }
        });

        const json = response.data; // Dengan axios, data ada di `response.data`
        
        console.log("Response from external API:", JSON.stringify(json, null, 2));

        if (!json?.data || json.data.length === 0 || !json.data[0].url) {
            const apiMessage = json.message || 'No image URL was returned.';
            throw new Error(`Fetch to external API succeeded, but the response was invalid. API Message: ${apiMessage}`);
        }

        return json.data[0].url;
    } catch (error) {
        // Axios membungkus error response di dalam `error.response`
        if (error.response) {
            console.error('Error from external API:', error.response.status, error.response.data);
            throw new Error(`External API fetch failed: ${error.response.statusText}. Details: ${JSON.stringify(error.response.data)}`);
        }
        // Untuk error jaringan atau lainnya
        throw error;
    }
};


// Endpoint untuk melayani halaman utama
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint untuk proses generate gambar
app.post('/generate', upload.single('image'), async (req, res) => {
    try {
        const { style, size } = req.body;
        const imageFile = req.file;

        if (!imageFile) {
            return res.status(400).json({ error: 'No image file uploaded.' });
        }
        if (!style || !stylePrompts[style]) {
            return res.status(400).json({ error: 'Invalid or missing style parameter.' });
        }
        if (!size || !validSizes.includes(size)) {
            return res.status(400).json({ error: 'Invalid or missing size parameter.' });
        }

        const prompt = stylePrompts[style];
        console.log(`Image received. Style: ${style}, Size: ${size}. Forwarding to external API...`);
        
        const imageUrl = await generateArtImage(imageFile.buffer, prompt, size);
        console.log("Successfully generated image URL:", imageUrl);
        
        res.json({ imageUrl: imageUrl });

    } catch (error) {
        console.error('Error in /generate endpoint:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Jalankan server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
