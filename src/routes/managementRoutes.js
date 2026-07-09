import { Router } from 'express';
import { sendData, sendError } from '../lib/apiResponse.js';
import { buildManagementOverview, normalizeManagementScope } from '../services/managementOverviewEngine.js';
import {
  draftOperationProposal,
  listOperationEvents,
  listOperationProposals,
  validateProposalFilters
} from '../services/operationProposalEngine.js';
import { confirmOperationProposal } from '../services/operationExecutor.js';

const router = Router();

router.get('/overview', async (req, res, next) => {
  try {
    const scope = normalizeManagementScope(req.query.scope);

    if (req.query.scope && !['learning', 'memory', 'actions', 'all'].includes(String(req.query.scope).toLowerCase())) {
      return sendError(res, 400, 'scope must be learning, memory, actions, or all', 'invalid_management_scope');
    }

    const overview = await buildManagementOverview({ scope });
    return sendData(res, overview);
  } catch (error) {
    return next(error);
  }
});

router.get('/proposals', async (req, res, next) => {
  try {
    validateProposalFilters(req.query);
    const proposals = await listOperationProposals(req.query);
    return sendData(res, { proposals });
  } catch (error) {
    return next(error);
  }
});

router.post('/proposals', async (req, res, next) => {
  try {
    const proposal = await draftOperationProposal(req.body || {});
    return sendData(res, { proposal }, 201);
  } catch (error) {
    return next(error);
  }
});

router.post('/proposals/:id/confirm', async (req, res, next) => {
  try {
    const result = await confirmOperationProposal(req.params.id, {
      confirmationText: req.body?.confirmation_text
    });
    return sendData(res, result);
  } catch (error) {
    return next(error);
  }
});

router.get('/operation-events', async (req, res, next) => {
  try {
    const events = await listOperationEvents({
      proposalId: req.query.proposalId,
      limit: req.query.limit
    });
    return sendData(res, { events });
  } catch (error) {
    return next(error);
  }
});

export default router;
