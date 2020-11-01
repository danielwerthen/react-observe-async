import React from 'react';
import { Meta, Story } from '@storybook/react';
import { useAsync } from '../src';

function asyncQuery(text: string): Promise<string> {
  return new Promise(resolve =>
    setTimeout(resolve, 500, `Response for: ${text}`)
  );
}

function AsyncComponent({ input }: any) {
  const { response = [] } = useAsync(
    async cache => {
      await cache.refresh('textbox');
      const data = await cache(() => asyncQuery('textbox'), 'textbox');
      const data2 = await cache(() => asyncQuery('slider'), 'slider');
      const extra = input
        ? await cache(() => asyncQuery(input), 'input|' + input)
        : 'No input';
      return [data, data2, extra];
    },
    [input]
  );
  return (
    <div>
      {response.map((res, idx) => (
        <p key={idx}>{res}</p>
      ))}
    </div>
  );
}

const meta: Meta = {
  title: 'Welcome',
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
