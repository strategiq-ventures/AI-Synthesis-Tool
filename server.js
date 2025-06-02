const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = 3000;

// Load meta-prompt at startup
let metaPromptTemplate = null;

async function loadMetaPrompt() {
    try {
        metaPromptTemplate = await fs.readFile(path.join(__dirname, 'meta-prompt.txt'), 'utf8');
        console.log('✅ Meta-prompt loaded successfully from meta-prompt.txt');
        console.log(`📄 Meta-prompt length: ${metaPromptTemplate.length} characters`);
    } catch (error) {
        console.error('❌ CRITICAL ERROR: Failed to load meta-prompt.txt');
        console.error('   File path:', path.join(__dirname, 'meta-prompt.txt'));
        console.error('   Error:', error.message);
        console.error('   Please ensure meta-prompt.txt exists in the project root directory.');
        process.exit(1); // Exit the server if meta-prompt can't be loaded
    }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve the HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to proxy Claude requests
app.post('/api/synthesize', async (req, res) => {
    try {
        // Check if meta-prompt is loaded
        if (!metaPromptTemplate) {
            return res.status(500).json({ error: 'Meta-prompt not loaded. Server needs to be restarted.' });
        }

        const { originalPrompt, responses, llmLabels, apiKey } = req.body;

        console.log('Received llmLabels:', llmLabels);
        console.log('Received responses count:', responses.length);

        if (!originalPrompt || !responses || !llmLabels || !apiKey) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (responses.length < 2) {
            return res.status(400).json({ error: 'At least 2 responses required' });
        }

        if (responses.length !== llmLabels.length) {
            return res.status(400).json({ error: 'Number of responses must match number of LLM labels' });
        }

        // Replace placeholders in meta-prompt
        const responseSection = responses.map((response, index) => 
            `${llmLabels[index]}: ${response}`
        ).join('\n\n');
        
        console.log('Response section preview:', responseSection.substring(0, 200) + '...');
        
        const metaPrompt = metaPromptTemplate
            .replace('{{ORIGINAL_PROMPT}}', originalPrompt)
            .replace('{{RESPONSES}}', responseSection);

        console.log('Final meta-prompt snippet:', metaPrompt.substring(metaPrompt.length - 500));

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 4000,
                messages: [{
                    role: 'user',
                    content: metaPrompt
                }]
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `API request failed with status ${response.status}`);
        }

        const data = await response.json();
        res.json({ result: data.content[0].text });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Initialize server
async function startServer() {
    await loadMetaPrompt(); // Load meta-prompt before starting server
    
    app.listen(PORT, () => {
        console.log(`🚀 Server running at http://localhost:${PORT}`);
        console.log(`📁 Serving files from: ${path.join(__dirname, 'public')}`);
        console.log(`📄 Meta-prompt file: ${path.join(__dirname, 'meta-prompt.txt')}`);
    });
}

startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});