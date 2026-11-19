import { PrismaClient } from '@prisma/client';

const globalPrisma = globalThis as unknown as { examPrisma?: PrismaClient };

export const prisma = globalPrisma.examPrisma ?? new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL || 'postgresql://invalid:invalid@localhost:5432/invalid' } },
});
globalPrisma.examPrisma = prisma;
