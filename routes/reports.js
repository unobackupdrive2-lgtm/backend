import express from 'express';
import { supabase } from '../config/database.js';
import { authenticateToken, requireCitizen, requireOfficial } from '../middleware/auth.js';
import { validateRequest, createReportSchema, updateReportSchema } from '../middleware/validation.js';
import { getMunicipalityFromCoordinates, formatError, formatSuccess } from '../utils/helpers.js';

const router = express.Router();

// Create a new report (citizens only)
router.post('/', authenticateToken, requireCitizen, validateRequest(createReportSchema), async (req, res) => {
  try {
    const { title, description, category, lat, lng, address, photo_url } = req.body;
    const userId = req.user.id;

    // Determine municipality from coordinates or user's municipality
    let municipalityId = req.user.municipality_id;
    
    if (!municipalityId) {
      municipalityId = await getMunicipalityFromCoordinates(lat, lng);
    }

    if (!municipalityId) {
      return res.status(400).json(formatError('Could not determine municipality for this location'));
    }

    const { data: report, error } = await supabase
      .from('reports')
      .insert({
        title,
        description,
        category,
        lat,
        lng,
        address,
        photo_url,
        municipality_id: municipalityId,
        created_by: userId
      })
      .select(`
        *,
        municipalities:municipality_id (
          id,
          name,
          province
        ),
        created_by_user:created_by (
          id,
          name,
          email
        )
      `)
      .single();

    if (error) {
      console.error('Create report error:', error);
      return res.status(400).json(formatError('Failed to create report'));
    }

    res.status(201).json(formatSuccess({ report }, 'Report created successfully'));

  } catch (error) {
    console.error('Create report error:', error);
    res.status(500).json(formatError('Internal server error'));
  }
});

// Get user's own reports (citizens only)
router.get('/mine', authenticateToken, requireCitizen, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, category, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('reports')
      .select(`
        *,
        municipalities:municipality_id (
          id,
          name,
          province
        )
      `)
      .eq('created_by', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (category) {
      query = query.eq('category', category);
    }

    const { data: reports, error } = await query;

    if (error) {
      return res.status(400).json(formatError('Failed to fetch reports'));
    }

    res.json(formatSuccess({ reports, total: reports.length }));

  } catch (error) {
    console.error('Get user reports error:', error);
    res.status(500).json(formatError('Internal server error'));
  }
});

// Get reports for municipality (officials only)
router.get('/', authenticateToken, requireOfficial, async (req, res) => {
  try {
    const { municipality_id, status, category, limit = 50, offset = 0 } = req.query;
    const userMunicipalityId = req.user.municipality_id;

    // Ensure official can only see reports from their municipality
    const targetMunicipalityId = municipality_id || userMunicipalityId;

    if (targetMunicipalityId !== userMunicipalityId) {
      return res.status(403).json(formatError('Access denied to reports from other municipalities'));
    }

    let query = supabase
      .from('reports')
      .select(`
        *,
        municipalities:municipality_id (
          id,
          name,
          province
        ),
        created_by_user:created_by (
          id,
          name,
          email
        ),
        assigned_official_user:assigned_official (
          id,
          name,
          email
        )
      `)
      .eq('municipality_id', targetMunicipalityId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (category) {
      query = query.eq('category', category);
    }

    const { data: reports, error } = await query;

    if (error) {
      return res.status(400).json(formatError('Failed to fetch reports'));
    }

    res.json(formatSuccess({ reports, total: reports.length }));

  } catch (error) {
    console.error('Get municipality reports error:', error);
    res.status(500).json(formatError('Internal server error'));
  }
});

// Get single report by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const currentUser = req.user;

    const { data: report, error } = await supabase
      .from('reports')
      .select(`
        *,
        municipalities:municipality_id (
          id,
          name,
          province
        ),
        created_by_user:created_by (
          id,
          name,
          email
        ),
        assigned_official_user:assigned_official (
          id,
          name,
          email
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      return res.status(404).json(formatError('Report not found'));
    }

    // Check access permissions
    const canAccess = 
      (currentUser.role === 'citizen' && report.created_by === currentUser.id) ||
      (currentUser.role === 'official' && report.municipality_id === currentUser.municipality_id);

    if (!canAccess) {
      return res.status(403).json(formatError('Access denied'));
    }

    res.json(formatSuccess({ report }));

  } catch (error) {
    console.error('Get report error:', error);
    res.status(500).json(formatError('Internal server error'));
  }
});

// Upvote a report (citizens only)
router.post('/:id/upvote', authenticateToken, requireCitizen, async (req, res) => {
  try {
    const { id: reportId } = req.params;
    const userId = req.user.id;

    // Check if report exists
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .select('id, created_by')
      .eq('id', reportId)
      .single();

    if (reportError || !report) {
      return res.status(404).json(formatError('Report not found'));
    }

    // Users cannot upvote their own reports
    if (report.created_by === userId) {
      return res.status(400).json(formatError('Cannot upvote your own report'));
    }

    // Check if user already upvoted
    const { data: existingUpvote } = await supabase
      .from('report_upvotes')
      .select('id')
      .eq('report_id', reportId)
      .eq('user_id', userId)
      .single();

    if (existingUpvote) {
      // Remove upvote
      const { error: deleteError } = await supabase
        .from('report_upvotes')
        .delete()
        .eq('report_id', reportId)
        .eq('user_id', userId);

      if (deleteError) {
        return res.status(400).json(formatError('Failed to remove upvote'));
      }

      res.json(formatSuccess({ upvoted: false }, 'Upvote removed'));
    } else {
      // Add upvote
      const { error: insertError } = await supabase
        .from('report_upvotes')
        .insert({
          report_id: reportId,
          user_id: userId
        });

      if (insertError) {
        return res.status(400).json(formatError('Failed to add upvote'));
      }

      res.json(formatSuccess({ upvoted: true }, 'Report upvoted'));
    }

  } catch (error) {
    console.error('Upvote error:', error);
    res.status(500).json(formatError('Internal server error'));
  }
});

// Update report (officials only)
router.put('/:id', authenticateToken, requireOfficial, validateRequest(updateReportSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const currentUser = req.user;

    // Verify official can access this report
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .select('municipality_id')
      .eq('id', id)
      .single();

    if (reportError || !report) {
      return res.status(404).json(formatError('Report not found'));
    }

    if (report.municipality_id !== currentUser.municipality_id) {
      return res.status(403).json(formatError('Access denied'));
    }

    // If assigning to an official, verify they belong to the same municipality
    if (updates.assigned_official) {
      const { data: official } = await supabase
        .from('users')
        .select('municipality_id, role')
        .eq('id', updates.assigned_official)
        .eq('role', 'official')
        .eq('municipality_id', currentUser.municipality_id)
        .single();

      if (!official) {
        return res.status(400).json(formatError('Invalid official assignment'));
      }
    }

    const { data: updatedReport, error } = await supabase
      .from('reports')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        municipalities:municipality_id (
          id,
          name,
          province
        ),
        created_by_user:created_by (
          id,
          name,
          email
        ),
        assigned_official_user:assigned_official (
          id,
          name,
          email
        )
      `)
      .single();

    if (error) {
      return res.status(400).json(formatError('Failed to update report'));
    }

    res.json(formatSuccess({ report: updatedReport }, 'Report updated successfully'));

  } catch (error) {
    console.error('Update report error:', error);
    res.status(500).json(formatError('Internal server error'));
  }
});

export default router;