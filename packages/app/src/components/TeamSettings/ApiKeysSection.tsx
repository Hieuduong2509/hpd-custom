import { useMemo, useState } from 'react';
import { HTTPError } from 'ky';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import {
  Box,
  Button,
  Card,
  Divider,
  Group,
  MultiSelect,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconClipboard, IconPlus, IconUsers } from '@tabler/icons-react';

import api from '@/api';

function APIKeyCopyButton({
  value,
  dataTestId,
}: {
  value: string;
  dataTestId?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <CopyToClipboard text={value}>
      <Button
        onClick={() => setCopied(true)}
        variant={copied ? 'light' : 'default'}
        color="gray"
        rightSection={
          <Group wrap="nowrap" gap={4} ms="xs">
            {copied ? <IconCheck size={14} /> : <IconClipboard size={14} />}
            {copied ? 'Copied!' : 'Copy'}
          </Group>
        }
      >
        <div data-test-id={dataTestId} className="text-wrap text-break">
          {value}
        </div>
      </Button>
    </CopyToClipboard>
  );
}

function CreateApiKeyModal({
  opened,
  onClose,
  onCreated,
}: {
  opened: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const createApiKey = api.useCreateTeamApiKey();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      return;
    }
    createApiKey.mutate(
      { name: name.trim() },
      {
        onSuccess: () => {
          notifications.show({
            color: 'green',
            message: `Created API key "${name.trim()}"`,
          });
          setName('');
          onCreated();
          onClose();
        },
        onError: e => {
          const message =
            e instanceof HTTPError
              ? undefined
              : 'Something went wrong creating the API key.';
          if (e instanceof HTTPError) {
            e.response
              .json()
              .then(res =>
                notifications.show({
                  color: 'red',
                  message: res.message ?? 'Failed to create API key',
                  autoClose: 5000,
                }),
              )
              .catch(() =>
                notifications.show({
                  color: 'red',
                  message: 'Failed to create API key',
                  autoClose: 5000,
                }),
              );
          } else {
            notifications.show({ color: 'red', message, autoClose: 5000 });
          }
        },
      },
    );
  };

  return (
    <Modal
      centered
      onClose={onClose}
      opened={opened}
      title="Create API Key"
      size="lg"
    >
      <form onSubmit={onSubmit}>
        <Stack>
          <TextInput
            data-testid="create-api-key-name-input"
            label="Name"
            placeholder="e.g. checkout-service, staging-ci"
            value={name}
            onChange={e => setName(e.target.value)}
            required
          />
          <div className="fs-8">
            This key grants the same ingestion access as your other
            keys — it&apos;s useful for issuing (and later revoking) a
            separate key per service or pipeline without rotating
            everyone else&apos;s key. After creating it, assign a dev to
            it from the &quot;Members&quot; column so they only see this
            key, not the others.
          </div>
          <Group justify="flex-end">
            <Button variant="secondary" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button
              data-testid="create-api-key-submit"
              variant="primary"
              type="submit"
              disabled={!name.trim() || createApiKey.isPending}
            >
              Create
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function ManageApiKeyMembersModal({
  opened,
  onClose,
  apiKeyId,
  apiKeyName,
  currentMemberIds,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  apiKeyId: string | null;
  apiKeyName: string;
  currentMemberIds: string[];
  onSaved: () => void;
}) {
  const { data: teamMembers, isLoading: isLoadingTeamMembers } =
    api.useTeamMembers();
  const setApiKeyMembers = api.useSetApiKeyMembers();
  const [selected, setSelected] = useState<string[]>(currentMemberIds);

  // Reset the local selection whenever a different key is opened.
  useMemo(() => {
    setSelected(currentMemberIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKeyId]);

  const options = useMemo(
    () =>
      (teamMembers?.data ?? []).map(m => ({
        value: m._id,
        label: m.name ? `${m.name} (${m.email})` : m.email,
      })),
    [teamMembers],
  );

  const onSave = () => {
    if (!apiKeyId) {
      return;
    }
    setApiKeyMembers.mutate(
      { id: apiKeyId, memberIds: selected },
      {
        onSuccess: () => {
          notifications.show({
            color: 'green',
            message: `Updated members for "${apiKeyName}"`,
          });
          onSaved();
          onClose();
        },
        onError: () => {
          notifications.show({
            color: 'red',
            message: 'Failed to update members',
            autoClose: 5000,
          });
        },
      },
    );
  };

  return (
    <Modal
      centered
      onClose={onClose}
      opened={opened}
      size="lg"
      title={`Manage members — ${apiKeyName}`}
    >
      <Stack>
        <Text size="sm" c="dimmed">
          Only devs assigned here will see this API key on their API Keys
          page. Admins and owners always see every key regardless of this
          list. This is a visibility convenience, not a hard security
          boundary — every member on the same team can still see any other
          service&apos;s data within the shared database.
        </Text>
        <MultiSelect
          data={options}
          value={selected}
          onChange={setSelected}
          disabled={isLoadingTeamMembers}
          searchable
          placeholder="Select devs who should see this key"
          label="Members"
        />
        <Group justify="flex-end">
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onSave}
            disabled={setApiKeyMembers.isPending}
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function ApiKeysSection() {
  const { data: team, refetch: refetchTeam } = api.useTeam();
  const { data: me, isLoading: isLoadingMe } = api.useMe();
  const rotateTeamApiKey = api.useRotateTeamApiKey();
  const hasAdminAccess = me?.role === 'admin' || me?.role === 'owner';

  const {
    data: apiKeys,
    isLoading: isLoadingApiKeys,
    refetch: refetchApiKeys,
  } = api.useTeamApiKeys();
  const revokeApiKey = api.useRevokeTeamApiKey();

  const [
    rotateApiKeyConfirmationModalShow,
    setRotateApiKeyConfirmationModalShow,
  ] = useState(false);
  const [createApiKeyModalShow, setCreateApiKeyModalShow] = useState(false);
  const [revokeApiKeyId, setRevokeApiKeyId] = useState<string | null>(null);
  const [manageMembersKeyId, setManageMembersKeyId] = useState<string | null>(
    null,
  );

  const manageMembersKey = (apiKeys?.data ?? []).find(
    k => k._id === manageMembersKeyId,
  );

  const rotateTeamApiKeyAction = () => {
    rotateTeamApiKey.mutate(undefined, {
      onSuccess: () => {
        notifications.show({
          color: 'green',
          message: 'Revoked old API key and generated new key.',
        });
        refetchTeam();
      },
      onError: e => {
        notifications.show({
          color: 'red',
          message: e.message,
          autoClose: 5000,
        });
      },
    });
  };

  const onConfirmUpdateTeamApiKey = () => {
    rotateTeamApiKeyAction();
    setRotateApiKeyConfirmationModalShow(false);
  };

  const onConfirmRevokeApiKey = () => {
    if (!revokeApiKeyId) {
      return;
    }
    revokeApiKey.mutate(
      { id: revokeApiKeyId },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: 'API key revoked' });
          refetchApiKeys();
        },
        onError: () => {
          notifications.show({
            color: 'red',
            message: 'Failed to revoke API key',
            autoClose: 5000,
          });
        },
      },
    );
    setRevokeApiKeyId(null);
  };

  return (
    <Box id="api_keys" data-testid="api-keys-section">
      <Text size="md">API Keys</Text>
      <Divider my="md" />

      {/*
        The shared default key ingests for the whole team with no
        per-service scoping, so it's hidden from devs entirely — showing
        it would defeat the point of assigning devs to specific
        "Additional API Keys" below. Admins/owners still manage it here.
      */}
      {hasAdminAccess && (
        <Card mb="md">
          <Text mb="md">Default Ingestion API Key</Text>
          <Group gap="xs">
            {team?.apiKey && (
              <APIKeyCopyButton value={team.apiKey} dataTestId="api-key" />
            )}
            <Button
              data-testid="rotate-api-key-button"
              variant="danger"
              onClick={() => setRotateApiKeyConfirmationModalShow(true)}
            >
              Rotate API Key
            </Button>
          </Group>
          <Modal
            aria-labelledby="contained-modal-title-vcenter"
            centered
            onClose={() => setRotateApiKeyConfirmationModalShow(false)}
            opened={rotateApiKeyConfirmationModalShow}
            size="lg"
            title={
              <Text size="xl">
                <b>Rotate API Key</b>
              </Text>
            }
          >
            <Modal.Body>
              <Text size="md">
                Rotating the API key will invalidate your existing API key
                and generate a new one for you. This action is{' '}
                <b>not reversible</b>.
              </Text>
              <Group justify="end">
                <Button
                  data-testid="rotate-api-key-cancel"
                  variant="secondary"
                  className="mt-2 px-4 ms-2 float-end"
                  size="sm"
                  onClick={() => setRotateApiKeyConfirmationModalShow(false)}
                >
                  Cancel
                </Button>
                <Button
                  data-testid="rotate-api-key-confirm"
                  variant="danger"
                  className="mt-2 px-4 float-end"
                  size="sm"
                  onClick={onConfirmUpdateTeamApiKey}
                >
                  Confirm
                </Button>
              </Group>
            </Modal.Body>
          </Modal>
        </Card>
      )}

      <Card mb="md" data-testid="additional-api-keys-section">
        <Card.Section withBorder py="sm" px="lg">
          <Group align="center" justify="space-between">
            <div className="fs-7">
              {hasAdminAccess ? 'Additional API Keys' : 'Your Service Keys'}
            </div>
            {hasAdminAccess && (
              <Button
                data-testid="create-api-key-button"
                variant="primary"
                leftSection={<IconPlus size={16} />}
                onClick={() => setCreateApiKeyModalShow(true)}
              >
                Create API Key
              </Button>
            )}
          </Group>
        </Card.Section>
        <Card.Section>
          {!isLoadingApiKeys &&
            Array.isArray(apiKeys?.data) &&
            apiKeys.data.length === 0 && (
              <Text c="dimmed" size="sm" p="lg">
                {hasAdminAccess
                  ? 'No additional API keys yet. The default key above works for every service — create one here only if you want a separate key you can revoke independently (e.g. per service or CI pipeline), and assign devs to it so they only see their own service.'
                  : "You haven't been assigned to a service API key yet. Ask an admin or owner to create one and add you as a member."}
              </Text>
            )}
          {!isLoadingApiKeys &&
            Array.isArray(apiKeys?.data) &&
            apiKeys.data.length > 0 && (
              <Table horizontalSpacing="lg" verticalSpacing="xs">
                <Table.Tbody>
                  {apiKeys.data.map(k => (
                    <Table.Tr key={k._id}>
                      <Table.Td>
                        <span className="text-white fw-bold fs-7">
                          {k.name}
                        </span>
                      </Table.Td>
                      <Table.Td>
                        <APIKeyCopyButton
                          value={k.key}
                          dataTestId={`api-key-${k._id}`}
                        />
                      </Table.Td>
                      {hasAdminAccess && (
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {(k.members ?? []).length === 0
                              ? 'No members assigned'
                              : (k.members ?? [])
                                .map(m => m.name || m.email)
                                .join(', ')}
                          </Text>
                        </Table.Td>
                      )}
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Group gap="xs" justify="flex-end" wrap="nowrap">
                          {hasAdminAccess && (
                            <Button
                              size="compact-sm"
                              variant="default"
                              leftSection={<IconUsers size={14} />}
                              onClick={() => setManageMembersKeyId(k._id)}
                            >
                              Members
                            </Button>
                          )}
                          {hasAdminAccess && (
                            <Button
                              size="compact-sm"
                              variant="danger"
                              onClick={() => setRevokeApiKeyId(k._id)}
                            >
                              Revoke
                            </Button>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
        </Card.Section>
      </Card>

      <CreateApiKeyModal
        opened={createApiKeyModalShow}
        onClose={() => setCreateApiKeyModalShow(false)}
        onCreated={refetchApiKeys}
      />

      <ManageApiKeyMembersModal
        opened={manageMembersKeyId != null}
        onClose={() => setManageMembersKeyId(null)}
        apiKeyId={manageMembersKeyId}
        apiKeyName={manageMembersKey?.name ?? ''}
        currentMemberIds={(manageMembersKey?.members ?? []).map(m => m._id)}
        onSaved={refetchApiKeys}
      />

      <Modal
        centered
        onClose={() => setRevokeApiKeyId(null)}
        opened={revokeApiKeyId != null}
        size="lg"
        title="Revoke API Key"
      >
        <Stack>
          <Text>
            Any service still sending data with this key will stop being
            able to ingest. This action is not reversible.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="secondary" onClick={() => setRevokeApiKeyId(null)}>
              Cancel
            </Button>
            <Button
              data-testid="confirm-revoke-api-key"
              variant="danger"
              onClick={onConfirmRevokeApiKey}
            >
              Confirm
            </Button>
          </Group>
        </Stack>
      </Modal>

      {!isLoadingMe && me != null && (
        <Card>
          <Card.Section p="md">
            <Text mb="md">Personal API Access Key</Text>
            <APIKeyCopyButton value={me.accessKey} dataTestId="api-key" />
          </Card.Section>
        </Card>
      )}
    </Box>
  );
}
