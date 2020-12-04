import React, { useMemo } from 'react';
import { Meta, Story } from '@storybook/react';
import { useAsync } from '../src';
import { interval } from 'rxjs';
import { take } from 'rxjs/operators';
import { AsyncFactory } from '../src/types';

function asyncQuery(text: string): Promise<string> {
  return new Promise(resolve =>
    setTimeout(resolve, 500, `Response for: ${text}`)
  );
}

const test = interval(1000).pipe(take(20));

const factory: AsyncFactory<string> = async observe => {
  const id = await observe(test);

  return await asyncQuery('Text' + Math.floor(id / 2));
};

function StepsComponent({ input }: any) {
  const result = useAsync(factory, [input]);
  const steps = useMemo(() => [], []);
  steps.push(result.result);
  return (
    <div>
      <pre>{JSON.stringify(steps, null, '  ')}</pre>
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
