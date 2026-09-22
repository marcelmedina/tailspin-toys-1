import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../db/test-helpers';
import { categories, publishers, games } from '../../db/schema';
import type { Database } from './db';
import {
    getAllCategories,
    getAllGames,
    getAllGameIds,
    getAllPublishers,
    getGameById,
    getGamesByFilters,
} from './games';

async function seedGames(db: Database, count: number): Promise<void> {
    const [category] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'cat' })
        .returning({ id: categories.id });
    const [publisher] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'pub' })
        .returning({ id: publishers.id });

    // Insert titles in reverse-alphabetical order to prove ordering is applied.
    for (let i = count; i >= 1; i--) {
        await db.insert(games).values({
            title: `Game ${String(i).padStart(2, '0')}`,
            description: `Description ${i}`,
            starRating: 4.2,
            categoryId: category.id,
            publisherId: publisher.id,
        });
    }
}

describe('games data-access helpers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    it('returns all games ordered by title', async () => {
        await seedGames(db, 3);
        const all = await getAllGames(db);
        expect(all.map((g) => g.title)).toEqual(['Game 01', 'Game 02', 'Game 03']);
        expect(all[0].category).toEqual({ id: expect.any(Number), name: 'Strategy' });
        expect(all[0].publisher).toEqual({ id: expect.any(Number), name: 'Pub One' });
    });

    it('returns all game ids ordered by title', async () => {
        await seedGames(db, 3);
        const ids = await getAllGameIds(db);
        const all = await getAllGames(db);
        expect(ids).toEqual(all.map((g) => g.id));
    });

    it('filters games by one or more categories', async () => {
        const [strategy] = await db
            .insert(categories)
            .values({ name: 'Strategy', description: 'cat' })
            .returning({ id: categories.id });
        const [party] = await db
            .insert(categories)
            .values({ name: 'Party', description: 'cat' })
            .returning({ id: categories.id });
        const [publisher] = await db
            .insert(publishers)
            .values({ name: 'Pub One', description: 'pub' })
            .returning({ id: publishers.id });

        await db.insert(games).values([
            {
                title: 'Strategy Game',
                description: 'Description',
                categoryId: strategy.id,
                publisherId: publisher.id,
            },
            {
                title: 'Party Game',
                description: 'Description',
                categoryId: party.id,
                publisherId: publisher.id,
            },
        ]);

        const filtered = await getGamesByFilters(db, {
            categoryIds: [strategy.id],
        });
        expect(filtered.map((game) => game.title)).toEqual(['Strategy Game']);
    });

    it('combines category and publisher filters', async () => {
        const [category] = await db
            .insert(categories)
            .values({ name: 'Strategy', description: 'cat' })
            .returning({ id: categories.id });
        const [firstPublisher] = await db
            .insert(publishers)
            .values({ name: 'Pub One', description: 'pub' })
            .returning({ id: publishers.id });
        const [secondPublisher] = await db
            .insert(publishers)
            .values({ name: 'Pub Two', description: 'pub' })
            .returning({ id: publishers.id });

        await db.insert(games).values([
            {
                title: 'First Publisher Game',
                description: 'Description',
                categoryId: category.id,
                publisherId: firstPublisher.id,
            },
            {
                title: 'Second Publisher Game',
                description: 'Description',
                categoryId: category.id,
                publisherId: secondPublisher.id,
            },
        ]);

        const filtered = await getGamesByFilters(db, {
            categoryIds: [category.id],
            publisherId: secondPublisher.id,
        });
        expect(filtered.map((game) => game.title)).toEqual(['Second Publisher Game']);
    });

    it('returns categories and publishers ordered by name', async () => {
        await db.insert(categories).values([
            { name: 'Strategy', description: 'cat' },
            { name: 'Party', description: 'cat' },
        ]);
        await db.insert(publishers).values([
            { name: 'Zed Games', description: 'pub' },
            { name: 'Alpha Games', description: 'pub' },
        ]);

        expect(await getAllCategories(db)).toEqual([
            { id: expect.any(Number), name: 'Party' },
            { id: expect.any(Number), name: 'Strategy' },
        ]);
        expect(await getAllPublishers(db)).toEqual([
            { id: expect.any(Number), name: 'Alpha Games' },
            { id: expect.any(Number), name: 'Zed Games' },
        ]);
    });

    it('fetches a single game by id', async () => {
        await seedGames(db, 2);
        const ids = await getAllGameIds(db);
        const game = await getGameById(db, ids[0]);
        expect(game?.title).toBe('Game 01');
    });

    it('returns null for a non-existent game', async () => {
        await seedGames(db, 2);
        expect(await getGameById(db, 99999)).toBeNull();
    });
});
