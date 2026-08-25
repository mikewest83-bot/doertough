import express from 'express';
import http from 'http';
import crypto from 'crypto';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { fal } from '@fal-ai/client';
import { LIVE_TOOLS as BASE_TOOLS, LIVE_TOOL_HANDLERS as BASE_HANDLERS } from './live.mjs';
import { BUSINESS_TOOLS, BUSINESS_TOOL_HANDLERS } from './business.mjs';
import { FREE_TOOLS, FREE_TOOL_HANDLERS } from './free-tools.mjs';
import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';
import { installGuards } from './guard.mjs';
import { mailerConfigured } from './mailer.mjs';
import { MIKE_INSTRUCTIONS } from './persona.mjs';
import { MIKE_OS } from './mike-os.mjs';
import { getRelevantMemories, listMemories, saveMemory, deleteMemory, memoryPrompt, CATEGORIES } from './memory.mjs';
import {
  migrate,
  hasPro,
  recordVoiceSession,
  closeVoiceSession,
  countVoiceSessions,
  countVoiceSessionsGlobal,
  countVoiceSeconds,
  countVoiceSecondsGlobal,
} from './db.mjs';
import {
  createCheckoutSession,
  createPortalSession,
  billingConfigured,
  hasActiveSubscription,
} from './billing.mjs';
import { initializeSpeechEngine, getSpeechEngineToken } from './speech-engine.mjs';
import {
  verifyStripeSignature,
  handleStripeWebhook,
} from './stripe.mjs';
