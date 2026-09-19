import { describe, expect, it } from 'vitest';
import { useTestDb } from '../test/setupTestDb.js';
import { createUser, findUserByUsername, setActive } from '../db/repo/users.js';
import { hashPassword } from './password.js';
import { AuthError, login } from './service.js';
import { config } from '../config.js';

async function makeUser(username: string, password: string) {
  const passwordHash = await hashPassword(password);
  return createUser({ username, email: `${username}@x.com`, passwordHash, globalRole: 'app_user' });
}

describe('login', () => {
  useTestDb();

  it('succeeds with correct credentials and returns a session', async () => {
    await makeUser('matt', 'correcthorsebattery');
    const { user, sessionId } = await login('matt', 'correcthorsebattery');
    expect(user.username).toBe('matt');
    expect(sessionId).toBeTruthy();
    expect(user.csrfToken).toBeTruthy();
  });

  it('rejects a wrong password with a generic message', async () => {
    await makeUser('matt', 'correcthorsebattery');
    await expect(login('matt', 'wrong')).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('rejects an unknown username with the same generic message (no enumeration)', async () => {
    await expect(login('ghost', 'whatever')).rejects.toMatchObject({
      code: 'invalid_credentials',
      message: 'Invalid username or password.',
    });
  });

  it('locks the account after the configured threshold of failed attempts', async () => {
    await makeUser('matt', 'correcthorsebattery');

    for (let i = 0; i < config.lockoutThreshold; i++) {
      await expect(login('matt', 'wrong')).rejects.toMatchObject({ code: 'invalid_credentials' });
    }

    // The threshold-th failure should have locked it -- even the *correct*
    // password is now rejected with a distinct, informative message.
    await expect(login('matt', 'correcthorsebattery')).rejects.toMatchObject({ code: 'locked_out' });
  });

  it('does not lock out before the threshold is reached', async () => {
    await makeUser('matt', 'correcthorsebattery');

    for (let i = 0; i < config.lockoutThreshold - 1; i++) {
      await expect(login('matt', 'wrong')).rejects.toMatchObject({ code: 'invalid_credentials' });
    }

    const { user } = await login('matt', 'correcthorsebattery');
    expect(user.username).toBe('matt');
  });

  it('resets the failed-attempt counter on a successful login', async () => {
    await makeUser('matt', 'correcthorsebattery');

    for (let i = 0; i < config.lockoutThreshold - 1; i++) {
      await expect(login('matt', 'wrong')).rejects.toBeInstanceOf(AuthError);
    }
    await login('matt', 'correcthorsebattery');

    const row = findUserByUsername('matt')!;
    expect(row.failed_login_count).toBe(0);
    expect(row.lockout_until).toBeNull();
  });

  it('rejects login for a deactivated user even with the correct password', async () => {
    const user = await makeUser('matt', 'correcthorsebattery');
    setActive(user.id, false);

    await expect(login('matt', 'correcthorsebattery')).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('rejects login for an account with no password set yet (pending invite)', async () => {
    createUser({ username: 'invitee', email: 'i@x.com', passwordHash: '', globalRole: 'app_user' });
    await expect(login('invitee', 'anything')).rejects.toMatchObject({ code: 'invalid_credentials' });
  });
});
