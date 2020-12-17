import React, {
  createContext,
  isValidElement,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
} from 'react';
import { BehaviorSubject, combineLatest, Observable, Subscription } from 'rxjs';
import { map, skipWhile, switchMap, take } from 'rxjs/operators';
import { useInitialize, useObservedProp } from './utils';

export type PendingState = 'init' | 'pending' | 'ready';

export type PendingInstance = {
  state: BehaviorSubject<PendingState>;
};

export type PendingContextInstance = {
  registerInstance(instance: PendingInstance): void;
  unregisterInstance(instance: PendingInstance): void;
  teardown(): void;
  pendingStates$: Observable<PendingState[]>;
};

function createInstance(): PendingContextInstance {
  const instances = new BehaviorSubject<Set<PendingInstance>>(new Set());
  const observer$ = instances.pipe(
    switchMap(set => combineLatest(Array.from(set.values()).map(v => v.state)))
  );
  const pendingStates$ = new BehaviorSubject<PendingState[]>([]);
  const sub = observer$.subscribe(pendingStates$);
  return {
    registerInstance(instance: PendingInstance) {
      instances.next(instances.value.add(instance));
    },
    unregisterInstance(instance: PendingInstance) {
      const val = instances.value;
      val.delete(instance);
      instances.next(val);
    },
    teardown() {
      sub.unsubscribe();
    },
    pendingStates$,
  };
}

const pendingContext = createContext(createInstance());

export function usePendingInstance() {
  const { registerInstance, unregisterInstance } = useContext(pendingContext);
  const instance = useMemo(() => {
    const res = {
      state: new BehaviorSubject<PendingState>('init'),
    };
    registerInstance(res);
    return res;
  }, [registerInstance]);
  useEffect(() => () => unregisterInstance(instance), [
    instance,
    unregisterInstance,
  ]);
  return instance;
}

export type PendingBoundaryProps = {
  onInit?: () => void;
};

export const PendingBoundary: React.FC<PendingBoundaryProps> = ({
  children,
  onInit,
}) => {
  const ctx = useInitialize(() => {
    return createInstance();
  });
  const onInit$ = useObservedProp(onInit);
  useEffect(() => {
    const initSub = ctx.pendingStates$
      .pipe(
        skipWhile(val => val.includes('init')),
        take(1),
        switchMap(() => onInit$)
      )
      .subscribe(fn => fn && fn());
    return () => {
      if (initSub) {
        initSub.unsubscribe();
      }
    };
  }, [ctx.pendingStates$, onInit$]);
  useEffect(() => () => ctx.teardown(), [ctx]);
  return (
    <pendingContext.Provider value={ctx}>{children}</pendingContext.Provider>
  );
};

function behaviorGuard(
  item: BehaviorSubject<boolean> | null
): item is BehaviorSubject<boolean> {
  return item !== null;
}

export const PendingSequence: React.FC<Omit<
  React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>,
  'ref'
>> = ({ children, ...rest }) => {
  const [list, cache] = useInitialize(() => {
    return [
      new Array(React.Children.count(children)).fill(
        null
      ) as (null | BehaviorSubject<boolean>)[],
      {} as { [key: string]: BehaviorSubject<boolean> },
    ];
  });
  useEffect(() => {
    return () => {
      Object.values(cache).forEach(item => {
        if (item) {
          item.complete();
        }
      });
    };
  }, [cache]);
  return (
    <>
      {React.Children.map(children, (child: ReactNode, index) => {
        if (isValidElement(child)) {
          const key = child.key || index;
          if (child.type === PendingBoundary) {
            let init$ =
              cache[key] || (cache[key] = new BehaviorSubject<boolean>(true));
            list[index] = init$;
            const dependants = list
              .slice(0, index)
              .filter<BehaviorSubject<boolean>>(behaviorGuard);
            const initialHide = dependants.some(v => v.value);
            let sub: Subscription | undefined;
            const hideRef = initialHide
              ? (instance: HTMLDivElement | null) => {
                  if (sub) {
                    sub.unsubscribe();
                  }
                  if (instance) {
                    instance.style.display = 'none';
                    sub = combineLatest(dependants)
                      .pipe(
                        map(values => values.some(item => item === true)),
                        skipWhile(v => v),
                        take(1)
                      )
                      .subscribe(() => {
                        instance.style.display = rest?.style?.display || '';
                      });
                  }
                }
              : undefined;
            return React.cloneElement(child, {
              key,
              onInit: () => {
                if (typeof child.props.onInit === 'function') {
                  child.props.onInit();
                }
                init$?.next(false);
              },
              children: (
                <div {...rest} ref={hideRef}>
                  {child.props.children}
                </div>
              ),
            });
          }
          return React.cloneElement(child, {
            key,
          });
        }
        return child;
      })}
    </>
  );
};
