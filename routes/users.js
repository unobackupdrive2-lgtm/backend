import express from 'express';
import { supabase } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { formatError, formatSuccess } from '../utils/helpers.js';

const router = express.Router();

// Get user by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const currentUser = req.user;

    // Users can only access their own data, or officials can access users in their municipality
    let query = supabase
      .from('users')
      .select(`
        id,
        name,
        email,
        role,
        municipality_id,
        home_address,
        lat,
        lng,
        created_at,
        municipalities:municipality_id (
          id,
          name,
          province
        )
      `)
      .eq('id', id);

    const { data: userData, error } = await query.single();

    if (error) {
      return res.status(404).json(formatError('User not found'));
    }

    // Check access permissions
    const canAccess = 
      currentUser.id === userData.id || // Own data
      (currentUser.role === 'official' && 
       currentUser.municipality_id === userData.municipality_id); // Same municipality official

    if (!canAccess) {
      return res.status(403).json(formatError('Access denied'));
    }

    res.json(formatSuccess({ user: userData }));

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json(formatError('Internal server error'));
  }
});

// Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const { data: userData, error } = await supabase
      .from('users')
      .select(`
        id,
        name,
        email,
        role,
        municipality_id,
        home_address,
        lat,
        lng,
        created_at,
        municipalities:municipality_id (
          id,
          name,
          province
        )
      `)
      .eq('id', req.user.id)
      .single();

    if (error) {
      return res.status(404).json(formatError('User not found'));
    }

    res.json(formatSuccess({ user: userData }));

  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json(formatError('Internal server error'));
  }
});

export default router;