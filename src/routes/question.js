import express from 'express';
import { answerQuestion } from '../services/aiService.js';
import { insertQuestion, addTagToQuestion, deleteOldQuestions } from '../models/database.js';

const router = express.Router();

// Ask a question endpoint
router.post('/ask', async (req, res) => {
    try {
        const { codebaseId, question, tags } = req.body;

        // Validation
        if (!codebaseId || !question) {
            return res.status(400).json({
                success: false,
                error: 'Codebase ID and question are required'
            });
        }

        if (question.trim().length < 5) {
            return res.status(400).json({
                success: false,
                error: 'Question must be at least 5 characters long'
            });
        }

        // Get answer from AI service
        const { answer, mermaidCode, fileReferences } = await answerQuestion(codebaseId, question);

        // Save question to database
        const result = await insertQuestion(codebaseId, question, answer, fileReferences, mermaidCode);
        const questionId = result.lastInsertRowid;

        // Add tags if provided
        if (tags && Array.isArray(tags)) {
            for (const tag of tags) {
                if (tag.trim()) {
                    await addTagToQuestion(questionId, tag.trim());
                }
            }
        }

        // Keep only last 10 questions
        await deleteOldQuestions(codebaseId, 10);

        res.json({
            success: true,
            questionId,
            answer,
            mermaidCode,
            fileReferences,
            message: 'Question answered successfully'
        });

    } catch (error) {
        console.error('Question error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to answer question'
        });
    }
});

export default router;
