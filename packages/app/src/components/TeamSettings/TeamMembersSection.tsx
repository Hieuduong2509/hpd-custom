import { useState } from 'react';
import { HTTPError } from 'ky';
import CopyToClipboard from 'react-copy-to-clipboard';
import {
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconLock, IconUserPlus } from '@tabler/icons-react';

import api from '@/api';
import { useBrandDisplayName } from '@/theme/ThemeProvider';

type EditableRole = 'admin' | 'owner' | 'dev';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  owner: 'Owner',
  dev: 'Dev',
};

function RoleBadge({ role }: { role?: string }) {
  if (!role) {
    return null;
  }
  const color = role === 'admin' ? 'red' : role === 'owner' ? 'blue' : 'gray';
  return (
    <Badge variant="light" color={color} fw="normal" tt="none">
      {ROLE_LABEL[role] ?? role}
    </Badge>
  );
}

function MemberRoleControl({
  userId,
  role,
  canEdit,
  onChanged,
}: {
  userId: string;
  role?: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const updateRole = api.useUpdateTeamMemberRole();

  if (!canEdit) {
    return <RoleBadge role={role} />;
  }

  return (
    <Select
      data-testid={`member-role-select-${userId}`}
      size="xs"
      w={110}
      allowDeselect={false}
      value={role ?? 'dev'}
      data={[
        { value: 'admin', label: 'Admin' },
        { value: 'owner', label: 'Owner' },
        { value: 'dev', label: 'Dev' },
      ]}
      disabled={updateRole.isPending}
      onChange={value => {
        if (!value || value === role) {
          return;
        }
        updateRole.mutate(
          { userId, role: value as EditableRole },
          {
            onSuccess: () => {
              notifications.show({
                color: 'green',
                message: `Updated role to ${ROLE_LABEL[value] ?? value}`,
              });
              onChanged();
            },
            onError: () => {
              notifications.show({
                color: 'red',
                message: 'Failed to update role',
                autoClose: 5000,
              });
            },
          },
        );
      }}
    />
  );
}

export default function TeamMembersSection() {
  const brandName = useBrandDisplayName();
  const { data: me } = api.useMe();
  const hasAdminAccess = me?.role === 'admin' || me?.role === 'owner';

  const {
    data: members,
    isLoading: isLoadingMembers,
    refetch: refetchMembers,
  } = api.useTeamMembers();

  const {
    data: invitations,
    isLoading: isLoadingInvitations,
    refetch: refetchInvitations,
  } = api.useTeamInvitations();

  const onSubmitTeamInviteForm = ({
    email,
    role,
    apiKeyId,
  }: {
    email: string;
    role: 'owner' | 'dev';
    apiKeyId?: string;
  }) => {
    sendTeamInviteAction(email, role, apiKeyId);
    setTeamInviteModalShow(false);
  };

  const [
    deleteTeamMemberConfirmationModalData,
    setDeleteTeamMemberConfirmationModalData,
  ] = useState<{
    mode: 'team' | 'teamInvite' | null;
    id: string | null;
    email: string | null;
  }>({
    mode: null,
    id: null,
    email: null,
  });
  const [teamInviteModalShow, setTeamInviteModalShow] = useState(false);

  const saveTeamInvitation = api.useSaveTeamInvitation();
  const deleteTeamMember = api.useDeleteTeamMember();
  const deleteTeamInvitation = api.useDeleteTeamInvitation();

  const sendTeamInviteAction = (
    email: string,
    role: 'owner' | 'dev',
    apiKeyId?: string,
  ) => {
    if (email) {
      saveTeamInvitation.mutate(
        { email, role, apiKeyId },
        {
          onSuccess: () => {
            notifications.show({
              color: 'green',
              message:
                'Click "Copy URL" and share the URL with your team member',
            });
            refetchInvitations();
          },
          onError: e => {
            if (e instanceof HTTPError) {
              e.response
                .json()
                .then(res => {
                  notifications.show({
                    color: 'red',
                    message: res.message,
                    autoClose: 5000,
                  });
                })
                .catch(() => {
                  notifications.show({
                    color: 'red',
                    message: `Something went wrong. Please contact ${brandName} team.`,

                    autoClose: 5000,
                  });
                });
            } else {
              notifications.show({
                color: 'red',
                message: `Something went wrong. Please contact ${brandName} team.`,
                autoClose: 5000,
              });
            }
          },
        },
      );
    }
  };

  const onConfirmDeleteTeamMember = (id: string) => {
    if (deleteTeamMemberConfirmationModalData.mode === 'team') {
      deleteTeamMemberAction(id);
    } else if (deleteTeamMemberConfirmationModalData.mode === 'teamInvite') {
      deleteTeamInviteAction(id);
    }
    setDeleteTeamMemberConfirmationModalData({
      mode: null,
      id: null,
      email: null,
    });
  };

  const deleteTeamInviteAction = (id: string) => {
    if (id) {
      deleteTeamInvitation.mutate(
        { id: encodeURIComponent(id) },
        {
          onSuccess: () => {
            notifications.show({
              color: 'green',
              message: 'Deleted team invite',
            });
            refetchInvitations();
          },
          onError: e => {
            if (e instanceof HTTPError) {
              // The delete is team-scoped, so an invite that is already gone
              // comes back 404 with no body. From the user's side that is a
              // no-op, not something worth the contact-support message.
              if (e.response.status === 404) {
                notifications.show({
                  color: 'yellow',
                  message: 'That invite has already been removed',
                  autoClose: 5000,
                });
                refetchInvitations();
                return;
              }
              e.response
                .json()
                .then(res => {
                  notifications.show({
                    color: 'red',
                    message: res.message,
                    autoClose: 5000,
                  });
                })
                .catch(() => {
                  notifications.show({
                    color: 'red',
                    message: `Something went wrong. Please contact ${brandName} team.`,

                    autoClose: 5000,
                  });
                });
            } else {
              notifications.show({
                color: 'red',
                message: `Something went wrong. Please contact ${brandName} team.`,
                autoClose: 5000,
              });
            }
          },
        },
      );
    }
  };
  const deleteTeamMemberAction = (id: string) => {
    if (id) {
      deleteTeamMember.mutate(
        { userId: encodeURIComponent(id) },
        {
          onSuccess: () => {
            notifications.show({
              color: 'green',
              message: 'Deleted team member',
            });
            refetchMembers();
          },
          onError: e => {
            if (e instanceof HTTPError) {
              e.response
                .json()
                .then(res => {
                  notifications.show({
                    color: 'red',
                    message: res.message,
                    autoClose: 5000,
                  });
                })
                .catch(() => {
                  notifications.show({
                    color: 'red',
                    message: `Something went wrong. Please contact ${brandName} team.`,
                    autoClose: 5000,
                  });
                });
            } else {
              notifications.show({
                color: 'red',
                message: `Something went wrong. Please contact ${brandName} team.`,
                autoClose: 5000,
              });
            }
          },
        },
      );
    }
  };

  return (
    <Box id="team_members" data-testid="team-members-section">
      <Text size="md">Team Members</Text>
      <Divider my="md" />
      <Card>
        <Card.Section withBorder py="sm" px="lg">
          <Group align="center" justify="space-between">
            <div className="fs-7">Team Members</div>
            {hasAdminAccess && (
              <Button
                data-testid="invite-member-button"
                variant="primary"
                leftSection={<IconUserPlus size={16} />}
                onClick={() => setTeamInviteModalShow(true)}
              >
                Invite Team Member
              </Button>
            )}
          </Group>
        </Card.Section>
        <Card.Section>
          <Table horizontalSpacing="lg" verticalSpacing="xs">
            <Table.Tbody>
              {!isLoadingMembers &&
                Array.isArray(members?.data) &&
                members?.data.map(member => (
                  <Table.Tr key={member.email}>
                    <Table.Td>
                      <div>
                        {member.isCurrentUser && (
                          <Badge variant="light" mr="xs" tt="none">
                            You
                          </Badge>
                        )}
                        <span className="text-white fw-bold fs-7">
                          {member.name}
                        </span>
                      </div>
                      <Group mt={4} fz="xs">
                        <div>{member.email}</div>
                        {member.hasPasswordAuth && (
                          <div>
                            <IconLock size={14} /> Password Auth
                          </div>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {member.groupName && (
                        <Badge
                          variant="light"
                          color="green"
                          fw="normal"
                          tt="none"
                        >
                          {member.groupName}
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <MemberRoleControl
                        userId={member._id}
                        role={member.role}
                        canEdit={hasAdminAccess && !member.isCurrentUser}
                        onChanged={refetchMembers}
                      />
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {!member.isCurrentUser && hasAdminAccess && (
                        <Group justify="flex-end" gap="8">
                          <Button
                            size="compact-sm"
                            variant="danger"
                            onClick={() =>
                              setDeleteTeamMemberConfirmationModalData({
                                mode: 'team',
                                id: member._id,
                                email: member.email,
                              })
                            }
                          >
                            Remove
                          </Button>
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              {!isLoadingInvitations &&
                Array.isArray(invitations?.data) &&
                invitations.data.map(invitation => (
                  <Table.Tr key={invitation.email} className="mt-2">
                    <Table.Td>
                      <span className="text-white fw-bold fs-7">
                        {invitation.email}
                      </span>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="dot" color="gray" fw="normal" tt="none">
                        Pending Invite
                      </Badge>
                      <CopyToClipboard text={invitation.url}>
                        <Button size="compact-xs" variant="secondary" ml="xs">
                          📋 Copy URL
                        </Button>
                      </CopyToClipboard>
                    </Table.Td>
                    <Table.Td />
                    <Table.Td style={{ textAlign: 'right' }}>
                      {hasAdminAccess && (
                        <Group justify="flex-end" gap="8">
                          <Button
                            size="compact-sm"
                            variant="danger"
                            onClick={() =>
                              setDeleteTeamMemberConfirmationModalData({
                                mode: 'teamInvite',
                                id: invitation._id,
                                email: invitation.email,
                              })
                            }
                          >
                            Delete
                          </Button>
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
        </Card.Section>
      </Card>

      <Modal
        centered
        onClose={() => setTeamInviteModalShow(false)}
        opened={teamInviteModalShow}
        title="Invite Team Member"
      >
        <InviteTeamMemberForm
          onSubmit={onSubmitTeamInviteForm}
          isSubmitting={saveTeamInvitation.isPending}
        />
      </Modal>

      <Modal
        centered
        onClose={() =>
          setDeleteTeamMemberConfirmationModalData({
            mode: null,
            id: null,
            email: null,
          })
        }
        opened={deleteTeamMemberConfirmationModalData.id != null}
        size="lg"
        title="Delete Team Member"
      >
        <Stack>
          <Text>
            Deleting this team member (
            {deleteTeamMemberConfirmationModalData.email}) will revoke their
            access to the team&apos;s resources and services. This action is not
            reversible.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button
              data-testid="cancel-delete-member"
              variant="secondary"
              onClick={() =>
                setDeleteTeamMemberConfirmationModalData({
                  mode: null,
                  id: null,
                  email: null,
                })
              }
            >
              Cancel
            </Button>
            <Button
              data-testid="confirm-delete-member"
              variant="danger"
              onClick={() =>
                deleteTeamMemberConfirmationModalData.id &&
                onConfirmDeleteTeamMember(
                  deleteTeamMemberConfirmationModalData.id,
                )
              }
            >
              Confirm
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}

function InviteTeamMemberForm({
  isSubmitting,
  onSubmit,
}: {
  isSubmitting?: boolean;
  onSubmit: (arg0: {
    email: string;
    role: 'owner' | 'dev';
    apiKeyId?: string;
  }) => void;
}) {
  const [email, setEmail] = useState<string>('');
  const [role, setRole] = useState<'owner' | 'dev'>('dev');
  const [apiKeyId, setApiKeyId] = useState<string | null>(null);
  const { data: apiKeys } = api.useTeamApiKeys();
  const serviceOptions = (apiKeys?.data ?? []).map(k => ({
    value: k._id,
    label: k.name,
  }));

  return (
    <form
      onSubmit={e => {
        onSubmit({ email, role, apiKeyId: apiKeyId ?? undefined });
        e.preventDefault();
      }}
    >
      <Stack>
        <TextInput
          data-testid="invite-email-input"
          label="Email"
          name="email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          placeholder="you@company.com"
          withAsterisk={false}
        />
        <Select
          data-testid="invite-role-select"
          label="Role"
          allowDeselect={false}
          value={role}
          data={[
            { value: 'dev', label: 'Dev — can view their team’s data' },
            {
              value: 'owner',
              label: 'Owner — can also invite/manage members',
            },
          ]}
          onChange={value => {
            const nextRole = (value as 'owner' | 'dev') ?? 'dev';
            setRole(nextRole);
            if (nextRole === 'owner') {
              setApiKeyId(null);
            }
          }}
        />
        {role === 'dev' && (
          <Select
            data-testid="invite-service-select"
            label="Service (API Key)"
            description="Scopes this dev to one service's key — they won't see the team's other services or the shared default key. Leave empty to assign later."
            clearable
            placeholder={
              serviceOptions.length === 0
                ? 'No additional API keys yet — create one first'
                : 'Not assigned yet'
            }
            value={apiKeyId}
            data={serviceOptions}
            disabled={serviceOptions.length === 0}
            onChange={setApiKeyId}
          />
        )}
        <div className="fs-8">
          The invite link will automatically expire after 30 days.
        </div>
        <Button
          data-testid="send-invite-button"
          variant="primary"
          type="submit"
          disabled={!email || isSubmitting}
        >
          Send Invite
        </Button>
      </Stack>
    </form>
  );
}
