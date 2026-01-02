import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { userPreferences } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const updatePreferencesSchema = z.object({
  defaultMarket: z.enum(['TW', 'US']).optional(),
  defaultCurrency: z.enum(['TWD', 'USD']).optional(),
  twBrokerFeeRate: z.number().min(0).max(1).optional(),
  twTaxRate: z.number().min(0).max(1).optional(),
  usBrokerFee: z.number().min(0).optional(),
});

// GET /api/settings - Get user preferences
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let preferences = await db.query.userPreferences.findFirst({
      where: eq(userPreferences.userId, session.user.id),
    });

    // Create default preferences if not exists
    if (!preferences) {
      const [newPrefs] = await db
        .insert(userPreferences)
        .values({
          userId: session.user.id,
        })
        .returning();
      preferences = newPrefs;
    }

    return NextResponse.json({
      defaultMarket: preferences.defaultMarket,
      defaultCurrency: preferences.defaultCurrency,
      twBrokerFeeRate: parseFloat(preferences.twBrokerFeeRate ?? '0.001425'),
      twTaxRate: parseFloat(preferences.twTaxRate ?? '0.003'),
      usBrokerFee: parseFloat(preferences.usBrokerFee ?? '0'),
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

// PUT /api/settings - Update user preferences
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validation = updatePreferencesSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues },
        { status: 400 }
      );
    }

    const data = validation.data;

    // Check if preferences exist
    const existing = await db.query.userPreferences.findFirst({
      where: eq(userPreferences.userId, session.user.id),
    });

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.defaultMarket !== undefined) {
      updateData.defaultMarket = data.defaultMarket;
    }
    if (data.defaultCurrency !== undefined) {
      updateData.defaultCurrency = data.defaultCurrency;
    }
    if (data.twBrokerFeeRate !== undefined) {
      updateData.twBrokerFeeRate = data.twBrokerFeeRate.toString();
    }
    if (data.twTaxRate !== undefined) {
      updateData.twTaxRate = data.twTaxRate.toString();
    }
    if (data.usBrokerFee !== undefined) {
      updateData.usBrokerFee = data.usBrokerFee.toString();
    }

    if (existing) {
      await db
        .update(userPreferences)
        .set(updateData)
        .where(eq(userPreferences.id, existing.id));
    } else {
      await db.insert(userPreferences).values({
        userId: session.user.id,
        ...updateData,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}
