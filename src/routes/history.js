import express from 'express';
import { getRecentQuestions, searchQuestions, getAllCodebases } from '../models/database.js';

const router = express.Router();

// Get Q&A history for a codebase
router.get('/:codebaseId', async (req, res) => {
    try {
        const { codebaseId } = req.params;
        const { search, limit } = req.query;

        let questions;

        if (search) {
            questions = await searchQuestions(codebaseId, search);
        } else {
            const questionLimit = parseInt(limit) || 10;
            questions = await getRecentQuestions(codebaseId, questionLimit);
        }

        res.json({
            success: true,
            questions,
            count: questions.length
        });

    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch history'
        });
    }
});

// Get all codebases
router.get('/', async (req, res) => {
    try {
        const codebases = await getAllCodebases();

        res.json({
            success: true,
            codebases
        });

    } catch (error) {
        console.error('Codebases error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch codebases'
        });
    }
});

export default router;
