-- Add LOGOUT value to SecurityEventType enum
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'LOGOUT';
