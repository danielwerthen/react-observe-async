# Reacṭ̣-Observe-Async!

This library is an collection of my favorite ways of dealing with asynchronous state and side effects. Observables are my preffered approach to doing just that, however, Observables and rxjs is quite complicated compared to Promises and async await functions. This library tries to bridge this gap, by providing promise-based api to observable functionality.

## useAsync

```tsx
const { result, pending, error, refresh } = useAsync(() => {
  return fetch('https://jsonplaceholder.typicode.com/todos/');
}, []);
```

The `useAsync` hook allows you to call asynchronous closures and retrieve the output in a painless way, and at the same time reduce the number of unnecessary rerenderings. It follows the convention of the standard react hooks in terms of the second dependency array.
