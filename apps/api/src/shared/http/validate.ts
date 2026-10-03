import type { CookieOptions, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import type { AuthContext } from './auth-context';
import { HttpError } from './error-handler';

type ObjectSchema = z.ZodObject;
/** A body may also be a union of objects discriminated on one key (e.g. `type`). */
type BodySchema = ObjectSchema | z.ZodDiscriminatedUnion;

export interface InputSchemas {
  params?: ObjectSchema;
  query?: ObjectSchema;
  body?: BodySchema;
}

/** Input schemas plus, optionally, the schema of the success body the handler sends. */
export interface RouteSchemas extends InputSchemas {
  response?: z.ZodType;
}

/**
 * `z.looseObject` is assignable to `z.object` in the type system, so it is rejected explicitly:
 * a loose schema's output admits any string key, a stripping (or strict) one does not (R-10).
 * The response schema is exempt: it describes what the API sends, not what it accepts.
 */
type StrippingMember<M> =
  M extends z.ZodObject<z.ZodRawShape, infer Config>
    ? string extends keyof Config['out']
      ? never
      : M
    : never;

type StrippingOnly<S extends RouteSchemas> = {
  [K in keyof S]: K extends 'response'
    ? S[K]
    : S[K] extends z.ZodDiscriminatedUnion<infer Options>
      ? Options[number] extends StrippingMember<Options[number]>
        ? S[K]
        : never
      : S[K] extends z.ZodObject<z.ZodRawShape, infer Config>
        ? string extends keyof Config['out']
          ? never
          : S[K]
        : never;
};

/** What `res.json` accepts: the response schema's input type, or anything without a schema. */
type ResponseBody<S extends RouteSchemas> = S['response'] extends z.ZodType
  ? z.input<S['response']>
  : unknown;

type Infer<T> = T extends BodySchema ? z.infer<T> : undefined;

export interface ValidatedInput<S extends RouteSchemas> {
  params: Infer<S['params']>;
  query: Infer<S['query']>;
  body: Infer<S['body']>;
}

/**
 * The only response operations a handler needs. Express' `Response` is not exposed because
 * `res.req` leads back to the raw, unvalidated request. `json` only accepts the route's response
 * schema type, so success bodies are typed with the shared schemas.
 */
export interface ResponseFacade<TBody = unknown> {
  status(code: number): ResponseFacade<TBody>;
  json(body: TBody): void;
  cookie(name: string, value: string, options: CookieOptions): ResponseFacade<TBody>;
  clearCookie(name: string, options?: CookieOptions): ResponseFacade<TBody>;
  setHeader(name: string, value: string): ResponseFacade<TBody>;
  /** 302 Found to `url`, with an empty body. */
  redirect(url: string): void;
  sendStatus(code: number): void;
  end(): void;
}

function responseFacade<TBody>(
  res: Response,
  responseSchema: z.ZodType | undefined,
): ResponseFacade<TBody> {
  const facade: ResponseFacade<TBody> = {
    status(code) {
      res.status(code);
      return facade;
    },
    json(body) {
      // Parsing strips undeclared fields, so a handler cannot leak one; a body that does not match
      // throws and becomes 500 INTERNAL (fail closed).
      res.json(responseSchema ? responseSchema.parse(body) : body);
    },
    cookie(name, value, options) {
      res.cookie(name, value, options);
      return facade;
    },
    clearCookie(name, options) {
      res.clearCookie(name, options);
      return facade;
    },
    setHeader(name, value) {
      res.setHeader(name, value);
      return facade;
    },
    redirect(url) {
      res.status(302).location(url).end();
    },
    sendStatus(code) {
      res.sendStatus(code);
    },
    end() {
      res.end();
    },
  };
  return facade;
}

/** cookie-parser turns `j:`-prefixed values into objects; only plain string cookies are kept. */
function stringCookies(cookies: unknown): Readonly<Record<string, string>> {
  if (typeof cookies !== 'object' || cookies === null) return {};
  return Object.fromEntries(
    Object.entries(cookies).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/**
 * What a handler may use besides its validated input. The raw request is deliberately absent so
 * no handler can read an unvalidated `req.body`, `req.query` or `req.params`.
 */
export interface HandlerContext<TBody = unknown> {
  res: ResponseFacade<TBody>;
  cookies: Readonly<Record<string, string>>;
  ip: string | undefined;
  requestId: string;
  /** Set when a session middleware ran before the route and authenticated the request. */
  auth: AuthContext | undefined;
}

const PARTS = ['params', 'query', 'body'] as const;

/**
 * The single validation middleware: parses params, query and body with the given Zod schemas
 * (unknown keys are stripped) and hands the handler only the parsed, typed values.
 * Failures become 400 `VALIDATION_FAILED` listing the failing paths, never the submitted values.
 */
export function validate<S extends RouteSchemas>(
  schemas: S & StrippingOnly<S>,
  handler: (input: ValidatedInput<S>, context: HandlerContext<ResponseBody<S>>) => unknown,
): RequestHandler {
  const partSchemas: RouteSchemas = schemas;
  return async (req, res) => {
    const parsed: Partial<Record<(typeof PARTS)[number], unknown>> = {};
    const fields = new Set<string>();

    for (const part of PARTS) {
      const schema = partSchemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        parsed[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          fields.add([part, ...issue.path.map(String)].join('.'));
        }
      }
    }

    if (fields.size > 0) {
      throw new HttpError(400, 'VALIDATION_FAILED', [...fields]);
    }

    const context: HandlerContext<ResponseBody<S>> = {
      res: responseFacade(res, partSchemas.response),
      cookies: stringCookies(req.cookies),
      ip: req.ip,
      requestId: res.locals.requestId,
      auth: req.auth,
    };
    // Each present part was produced by its own schema above, so the shape matches ValidatedInput<S>.
    await handler(parsed as ValidatedInput<S>, context);
  };
}
