import dotenv from 'dotenv';
dotenv.config();

export const env = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
};

export function assertLocalDemoMode(): void {
  if (env.nodeEnv === 'production') {
    throw new Error('[agent-router] production runtime disabled: this fixture API has no authentication or provider dispatch.');
  }
}
