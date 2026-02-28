import express from 'express';
import { getRecentQuestions, searchQuestions, getAllCodebases, deleteCodebase } from '../models/database.js';

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

// Delete a codebase session (cascades to files + questions)
router.delete('/:codebaseId', async (req, res) => {
    try {
        const { codebaseId } = req.params;
        const deleted = await deleteCodebase(codebaseId);

        if (!deleted) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }

        res.json({ success: true, message: 'Session deleted successfully' });
    } catch (error) {
        console.error('Delete session error:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to delete session' });
    }
});

export default router;
