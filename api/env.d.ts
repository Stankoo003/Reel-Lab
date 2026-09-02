/**
 * The environment variables this app reads.
 *
 * Declared explicitly rather than pulling in @types/node: most of Node's globals do
 * not exist in React Native, and listing them here doubles as documentation of the
 * config surface. Adding a variable to .env means adding it here too.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    readonly EXPO_PUBLIC_API_BASE_URL?: string;
    readonly EXPO_PUBLIC_MEDIA_BASE_URL?: string;
    readonly EXPO_PUBLIC_APP_ENV?: string;
  }
}

declare const process: { env: NodeJS.ProcessEnv };
