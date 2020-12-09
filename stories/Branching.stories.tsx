import React from 'react';
import { Meta, Story } from '@storybook/react';
import { useAsync, useAsyncElement } from '../src';
import { from, of } from 'rxjs';
import { concatMap, delay, map } from 'rxjs/operators';

function asyncQuery(text: string): Promise<string> {
  return new Promise(resolve =>
    setTimeout(resolve, 500, `Response for: ${text}`)
  );
}

function AsyncComponent({ input }: any) {
  const { result } = useAsync(async () => {
    const res = await asyncQuery('test');
    return from([1, 2, 3, 4]).pipe(
      concatMap(item =>
        of(item).pipe(
          delay(1000),
          map(item => res + item)
        )
      )
    );
  }, []);
  const separate = useAsyncElement(async () => {
    const text = await asyncQuery('text');
    return (
      <p>
        {text} + {input}
      </p>
    );
  }, [input]);
  return (
    <div>
      {result} {separate}
    </div>
  );
}

const meta: Meta = {
  title: 'Branching views',
  component: AsyncComponent,
  argTypes: {
    input: {
      control: {
        type: 'text',
      },
    },
    children: {
      control: {
        type: 'text',
      },
    },
  },
  parameters: {
    controls: { expanded: true },
  },
};

export default meta;

const Template: Story<{}> = args => <AsyncComponent input="" {...args} />;

// By passing using the Args format for exported stories, you can control the props for a component for reuse in a test
// https://storybook.js.org/docs/react/workflows/unit-testing
export const Default = Template.bind({});

Default.args = {};
