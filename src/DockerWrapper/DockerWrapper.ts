import * as methods from './methods/index.cjs';

export * from './DockerWrapper.cjs';

type Methods = typeof methods;
declare module './DockerWrapper' {
  interface DockerWrapper extends Methods { }
}