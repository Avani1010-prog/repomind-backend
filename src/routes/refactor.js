import express from 'express';
import { generateRefactorSuggestions } from '../services/aiService.js';

const router = express.Router();

// Generate refactor suggestions
router.post('/', async (req, res) => {
    try {
        const { code, language } = req.body;

        if (!code || !language) {
            return res.status(400).json({
                success: false,
                error: 'Code and language are required'
            });
        }

        const suggestions = await generateRefactorSuggestions(code, language);

        res.json({
            success: true,
            suggestions
        });

    } catch (error) {
        console.error('Refactor error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to generate suggestions'
        });
    }
});

export default router;
