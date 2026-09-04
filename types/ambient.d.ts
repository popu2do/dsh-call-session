/**
 * Ambient type definitions for Cordis and Schemastery within DSH Plugin ecosystem.
 * Provides fallback module declarations when devDependencies are resolved statically.
 */

declare module '@deepseek-ai/cordis' {
  export interface Context {
    get?(name: string, fallback?: any): any;
    tools?: {
      register(toolDef: any): void;
      get?(name: string): any;
      [key: string]: any;
    };
    commands?: {
      register(cmdDef: any): void;
      [key: string]: any;
    };
    systemPrompt?: {
      add(name: string, content: string | (() => string), options?: { order?: number; [key: string]: any }): void;
      [key: string]: any;
    };
    on(event: 'dispose' | string, listener: (...args: any[]) => any): void;
    inject?(deps: string[], callback: (ctx: Context) => void): void;
    root?: any;
    agents?: any;
    [key: string]: any;
  }
}

declare module '@deepseek-ai/schemastery' {
  export interface Schema<S = any, T = S> {
    default(value: T): Schema<S, T>;
    description(desc: string): Schema<S, T>;
    min(value: number): Schema<S, T>;
    max(value: number): Schema<S, T>;
    step(value: number): Schema<S, T>;
    role(role: string): Schema<S, T>;
    hidden(): Schema<S, T>;
    (value?: any): T;
  }

  export interface Schemastery {
    <T = any>(schema: any): Schema<T>;
    boolean(): Schema<boolean>;
    string(): Schema<string>;
    number(): Schema<number>;
    natural(): Schema<number>;
    integer(): Schema<number>;
    percent(): Schema<number>;
    object<T extends Record<string, any>>(dict: T): Schema<{ [K in keyof T]: T[K] extends Schema<any, infer R> ? R : any }>;
    array<T>(item: Schema<T>): Schema<T[]>;
    dict<T>(value: Schema<T>): Schema<Record<string, T>>;
    union<T>(types: Schema<T>[]): Schema<T>;
    intersect<T>(types: Schema<T>[]): Schema<T>;
    Schema: any;
  }

  const z: Schemastery;
  export default z;
}
