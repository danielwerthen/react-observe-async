import React, { useMemo } from 'react';
import { Meta, Story } from '@storybook/react';
import { useAsync } from '../src';
import { interval } from 'rxjs';
import { take } from 'rxjs/operators';

function asyncQuery(text: string): Promise<string> {
  return new Promise(resolve =>
    setTimeout(resolve, 500, `Response for: ${text}`)
  );
}

const test = interval(1000).pipe(take(10));

function StepsComponent({ input }: any) {
  const result = useAsync(
    async observe => {
      await observe(test);
      return Promise.all([asyncQuery('Test')]) as Promise<any[]>;
    },
    [input]
  );
  const steps = useMemo(() => [], []);
  steps.push(steps.length > 8 ? result : result.result || 'none');
  return (
    <div>
      {steps.map((res, idx) => (
        <pre key={idx}>{JSON.stringify(res)}</pre>
      ))}
    </div>
  );
}

const meta: Meta = {
  title: 'Steps',
  component: StepsComponent,
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

const Template: Story<{}> = args => <StepsComponent input="" {...args} />;

// By passing using the Args format for exported stories, you can control the props for a component for reuse in a test
// https://storybook.js.org/docs/react/workflows/unit-testing
export const Default = Template.bind({});

Default.args = {};
