export interface ReactorResult<Body> {
  status: number;
  body: Body;
}

export function ok<Body>(status: number, body: Body): ReactorResult<Body> {
  return { status, body };
}
