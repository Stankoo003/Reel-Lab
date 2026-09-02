-- Development seed. Loaded only under the `dev` profile via a separate Flyway
-- location, so it cannot reach a real deployment.
--
-- Every media path below is RELATIVE. No scheme, no host, no leading slash —
-- the CDN base comes from configuration at response time.

-- Both accounts share the development password documented in README.md. BCrypt, because
-- that is what the application verifies against — a plaintext column would not be a
-- shortcut, it would simply not work.
insert into users (id, username, email, display_name, password_hash)
values ('11111111-1111-4111-8111-111111111111', 'aleksa', 'aleksa@example.com', 'Aleksa',
        '$2y$10$jBp.1zK3y4K4LDy668scneNa/oOg6qwitmP/9aGJ0OxN0fY4dW48.'),
       ('22222222-2222-4222-8222-222222222222', 'mila', 'mila@example.com', 'Mila',
        '$2y$10$jBp.1zK3y4K4LDy668scneNa/oOg6qwitmP/9aGJ0OxN0fY4dW48.');

insert into videos (id, owner_id, title, description, duration_seconds,
                    manifest_path, poster_path, published)
values ('33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
        'Big Buck Bunny (excerpt)',
        'Blender Foundation, CC-BY 3.0. 30s excerpt from the 2008 trailer.',
        30,
        'videos/blender/big-buck-bunny/clip.mp4',
        'posters/blender/big-buck-bunny.jpg',
        true),
       ('44444444-4444-4444-8444-444444444444',
        '22222222-2222-4222-8222-222222222222',
        'Sintel (excerpt)',
        'Blender Foundation, CC-BY 3.0. 30s excerpt from the 2010 trailer.',
        30,
        'videos/blender/sintel/clip.mp4',
        'posters/blender/sintel.jpg',
        false);

insert into comments (id, video_id, author_id, parent_id, body)
values ('55555555-5555-4555-8555-555555555555',
        '33333333-3333-4333-8333-333333333333',
        '22222222-2222-4222-8222-222222222222',
        null,
        'Colour grade holds up at 720p.'),
       ('66666666-6666-4666-8666-666666666666',
        '33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
        '55555555-5555-4555-8555-555555555555',
        'Agreed — CRF 21 was the right call.');
