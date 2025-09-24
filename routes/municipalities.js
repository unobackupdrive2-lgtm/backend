import express from 'express';
import { supabase } from '../config/database.js';
import { formatError, formatSuccess } from '../utils/helpers.js';

const router = express.Router();

// Get all municipalities (public endpoint)
router.get('/', async (req, res) => {
  try {
    const { data: municipalities, error } = await supabase
      .from('municipalities')
      .select('*')
      .order('name');

    if (error) {
      return res.status(400).json(formatError('Failed to fetch municipalities'));
    }

    res.json(formatSuccess({ municipalities }));

  } catch (error) {
    console.error('Get municipalities error:', error);
    res.status(500).json(formatError('Internal server error'));
  }
});

// Get single municipality by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: municipality, error } = await supabase
      .from('municipalities')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return res.status(404).json(formatError('Municipality not found'));
    }

    res.json(formatSuccess({ municipality }));

  } catch (error) {
    console.error('Get municipality error:', error);
    res.status(500).json(formatError('Internal server error'));
  }
});

export default router;