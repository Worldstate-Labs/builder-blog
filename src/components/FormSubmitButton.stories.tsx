import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormSubmitButton } from "./FormSubmitButton";

// FormSubmitButton reads useFormStatus(), so it must live inside a <form> with
// an action to show its pending state. The stories wrap it accordingly.
const meta = {
  title: "Actions/FormSubmitButton",
  component: FormSubmitButton,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof FormSubmitButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <form action={() => {}}>
      <FormSubmitButton {...args}>Save changes</FormSubmitButton>
    </form>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <form action={() => {}}>
      <FormSubmitButton {...args} disabled>
        Save changes
      </FormSubmitButton>
    </form>
  ),
};

export const Pending: Story = {
  name: "Pending (click to submit)",
  args: { pendingLabel: "Saving" },
  render: (args) => (
    <form
      action={async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }}
    >
      <FormSubmitButton {...args}>Save changes</FormSubmitButton>
    </form>
  ),
};
