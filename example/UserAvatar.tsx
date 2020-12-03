import * as React from 'react';
import { createSharedFetch } from '../src';
import { init } from './auth';

interface UserInterface {
  id: number;
  name: string;
}

const users = createSharedFetch(
  init,
  (userId: number) => `https://jsonplaceholder.typicode.com/users/${userId}`,
  response => response.json() as Promise<UserInterface>
);

export default function UserAvatar({ userId }: { userId: number }) {
  const { result: user } = users(userId).useSubscribe();
  if (!user) {
    return null;
  }
  return (
    <div key={user.id} className="user-avatar">
      <img
        src={`https://i.pravatar.cc/50?img=${user.id + 10}`}
        width="50"
        height="50"
        alt={user.name}
      />
      <label>{user.name}</label>
    </div>
  );
}
