import {
  addHoldingRequestSchema,
  addHoldingResponseSchema,
  holdingIdParamsSchema,
  holdingResponseSchema,
  portfolioIdParamsSchema,
  setPriceRequestSchema,
  updateHoldingRequestSchema,
} from '@pesly/shared';
import { Router } from 'express';
import type {
  AddHolding,
  DeleteHolding,
  GetHolding,
  SetManualPrice,
  UpdateHolding,
  UseAutomaticPrice,
} from '../../application/holding-use-cases';
import type { HoldingEditPatch } from '../../domain/holding';
import type { AccessPolicy } from '../../../shared/access';
import { validate } from '../../../shared/http/validate';
import type { Logger } from '../../../shared/logging/logger';
import { scopeOf } from './scope';
import { serializeHolding } from './serializers';

export interface HoldingRoutesDependencies {
  policy: AccessPolicy;
  logger: Logger;
  addHolding: AddHolding;
  getHolding: GetHolding;
  updateHolding: UpdateHolding;
  setManualPrice: SetManualPrice;
  useAutomaticPrice: UseAutomaticPrice;
  deleteHolding: DeleteHolding;
}

/**
 * The holding routes, mounted under the module's session and verified-email guards. The user
 * always comes from `auth`; quantities, costs, prices and names are never logged (threat R-15).
 * Integer strings become `BigInt` here, at the boundary.
 */
export function holdingRoutes({
  policy,
  logger,
  addHolding,
  getHolding,
  updateHolding,
  setManualPrice,
  useAutomaticPrice,
  deleteHolding,
}: HoldingRoutesDependencies): Router {
  const router = Router();

  router.post(
    '/investments/portfolios/:portfolioId/holdings',
    validate(
      {
        params: portfolioIdParamsSchema,
        body: addHoldingRequestSchema,
        response: addHoldingResponseSchema,
      },
      async ({ params, body }, { res, auth, requestId }) => {
        const scope = await scopeOf(policy, auth, 'write');
        const { holding, merged } = await addHolding.execute(scope, {
          portfolioId: params.portfolioId,
          ticker: body.ticker,
          instrumentName: body.instrumentName,
          instrumentType: body.instrumentType,
          quantity: BigInt(body.quantity),
          valuationCurrency: body.valuationCurrency,
          ...(body.totalCost === undefined ? {} : { totalCost: BigInt(body.totalCost) }),
        });
        logger.info(
          {
            requestId,
            userId: scope.userId,
            action: merged ? 'holding.merge' : 'holding.add',
            holdingId: holding.id,
          },
          'investments.mutation',
        );
        res.status(merged ? 200 : 201).json({ holding: serializeHolding(holding), merged });
      },
    ),
  );

  router.get(
    '/investments/holdings/:holdingId',
    validate(
      { params: holdingIdParamsSchema, response: holdingResponseSchema },
      async ({ params }, { res, auth }) => {
        const scope = await scopeOf(policy, auth, 'read');
        res.json(serializeHolding(await getHolding.execute(scope, params.holdingId)));
      },
    ),
  );

  router.patch(
    '/investments/holdings/:holdingId',
    validate(
      {
        params: holdingIdParamsSchema,
        body: updateHoldingRequestSchema,
        response: holdingResponseSchema,
      },
      async ({ params, body }, { res, auth, requestId }) => {
        const scope = await scopeOf(policy, auth, 'write');
        // Absent keeps the stored value; totalCost null is a stated "clear the cost".
        const patch: HoldingEditPatch = {
          ...(body.quantity === undefined ? {} : { quantity: BigInt(body.quantity) }),
          ...(body.totalCost === undefined
            ? {}
            : { totalCost: body.totalCost === null ? null : BigInt(body.totalCost) }),
          ...(body.valuationCurrency === undefined
            ? {}
            : { valuationCurrency: body.valuationCurrency }),
        };
        const holding = await updateHolding.execute(scope, params.holdingId, patch);
        logger.info(
          { requestId, userId: scope.userId, action: 'holding.update', holdingId: holding.id },
          'investments.mutation',
        );
        res.json(serializeHolding(holding));
      },
    ),
  );

  router.put(
    '/investments/holdings/:holdingId/price',
    validate(
      {
        params: holdingIdParamsSchema,
        body: setPriceRequestSchema,
        response: holdingResponseSchema,
      },
      async ({ params, body }, { res, auth, requestId }) => {
        const scope = await scopeOf(policy, auth, 'write');
        const holding = await setManualPrice.execute(
          scope,
          params.holdingId,
          BigInt(body.unitPrice),
        );
        logger.info(
          { requestId, userId: scope.userId, action: 'holding.price', holdingId: holding.id },
          'investments.mutation',
        );
        res.json(serializeHolding(holding));
      },
    ),
  );

  router.post(
    '/investments/holdings/:holdingId/automatic-price',
    validate(
      { params: holdingIdParamsSchema, response: holdingResponseSchema },
      async ({ params }, { res, auth, requestId }) => {
        const scope = await scopeOf(policy, auth, 'write');
        const holding = await useAutomaticPrice.execute(scope, params.holdingId);
        logger.info(
          {
            requestId,
            userId: scope.userId,
            action: 'holding.automatic-price',
            holdingId: holding.id,
          },
          'investments.mutation',
        );
        res.json(serializeHolding(holding));
      },
    ),
  );

  router.delete(
    '/investments/holdings/:holdingId',
    validate({ params: holdingIdParamsSchema }, async ({ params }, { res, auth, requestId }) => {
      const scope = await scopeOf(policy, auth, 'write');
      await deleteHolding.execute(scope, params.holdingId);
      logger.info(
        {
          requestId,
          userId: scope.userId,
          action: 'holding.delete',
          holdingId: params.holdingId,
        },
        'investments.mutation',
      );
      res.sendStatus(204);
    }),
  );

  return router;
}
