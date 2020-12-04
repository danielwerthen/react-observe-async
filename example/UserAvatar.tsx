import * as React from 'react';
import { fromFetch } from 'rxjs/fetch';
import { sharedAsyncMap } from '../src';

interface UserInterface {
  id: number;
  name: string;
}

const users = sharedAsyncMap(
  (userId: number) => {
    return async observe => {
      return observe(
        fromFetch(`https://jsonplaceholder.typicode.com/users/${userId}`, {
          selector: res => res.json() as Promise<UserInterface>,
        })
      );
    };
  },
  (userId: number) => userId.toString()
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
