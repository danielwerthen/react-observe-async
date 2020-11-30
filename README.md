# Reacṭ̣-Observe-Async!

This library is an collection of my favorite ways of dealing with asynchronous state and side effects.

## useAsync

```tsx
const { result, pending, error, refresh } = useAsync(() => {
  return fetch('https://jsonplaceholder.typicode.com/todos/');
}, []);
```

The `useAsync` hook allows you to call asynchronous closures and retrieve the output in a painless way, and at the same time reduce the number of unnecessary rerenderings. It follows the convention of the standard react hooks in terms of the second dependency array.
